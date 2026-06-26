import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { isAdmin } from '../../../../lib/adminAuth';
import {
    getStripe,
    isStripeConfigured,
    isStripeTaxEnabled,
    GENERAL_GOODS_TAX_CODE,
    SHIPPING_TAX_CODE,
} from '../../../../lib/stripe';
import { pointsToUsd } from '../../../../lib/paymentUtils';
import { validateCartItems, getProductById } from '../../../../lib/productValidation';
import { isStructuredAddress, validateAddress, COUNTRIES } from '../../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';
import { saveGuestOrder } from '../../../../lib/guestOrders';
import { reserve, release, StockLine } from '../../../../lib/inventory';
import { validateQuotedRate, isShippingConfigured } from '../../../../lib/shipping';
import { cartAddressFingerprint } from '../../../../lib/checkoutUtils';
import { Order, ShippingAddress } from '../../../../types/Order';

// Countries Stripe Checkout will let the shopper enter an address for, when
// address collection is on (Stripe Tax). Derived from the shop's own supported
// list so it stays in sync; the `OTHER` pseudo-code isn't a real ISO country and
// is dropped (Stripe would reject it).
type AllowedCountry = NonNullable<
    Stripe.Checkout.SessionCreateParams['shipping_address_collection']
>['allowed_countries'][number];
const ALLOWED_COUNTRIES = COUNTRIES
    .map(c => c.code)
    .filter(c => c !== 'OTHER') as AllowedCountry[];

/**
 * Adult / guest checkout: creates a Stripe Checkout Session for a cart paid with
 * real money. No login required. Prices are re-derived server-side from Redis;
 * the client-sent prices are never trusted. The order is created in a `pending` /
 * `unpaid` state here and only marked `paid` by the signature-verified Stripe
 * webhook — the success redirect is never treated as proof of payment.
 *
 * Sales tax: when STRIPE_TAX_ENABLED is set, the session turns on Stripe Tax
 * (`automatic_tax`) and collects the customer's address so Stripe can compute
 * the right rate. Line items + shipping carry tax codes so Tax can classify
 * them. This is the capability HCB couldn't provide, which is why guest checkout
 * moved back to Stripe.
 */
export async function POST(request: Request) {
    if (!isStripeConfigured()) {
        return NextResponse.json({ error: 'Card payments are not available right now.' }, { status: 503 });
    }

    // Rate limit by IP (guests have no user id).
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`checkout:stripe:${ip}`, { maxRequests: 10, windowMs: 60000 });
    if (!rl.success) return rateLimitResponse();

    try {
        const { items, email, shippingCountry, checkoutData, selectedRate } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number }[];
            email?: string;
            shippingCountry?: string;
            checkoutData?: Record<string, string | ShippingAddress>;
            selectedRate?: { rateId: string; shipmentId: string; quoteId?: string };
        };

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'No items in order' }, { status: 400 });
        }

        // Extract + validate the shipping address from checkoutData (if present).
        let shippingAddress: ShippingAddress | undefined;
        for (const value of Object.values(checkoutData || {})) {
            if (isStructuredAddress(value)) {
                shippingAddress = value as ShippingAddress;
                break;
            }
        }
        if (shippingAddress) {
            const errs = validateAddress(shippingAddress);
            if (errs.length > 0) return NextResponse.json({ error: errs[0] }, { status: 400 });
        }
        const country = shippingAddress?.country || shippingCountry;

        // Re-validate items + re-derive trusted cash prices from Redis.
        const itemsWithStringVariantId = items.map(i => ({
            ...i,
            variant_id: i.variant_id != null ? String(i.variant_id) : undefined,
        }));
        const validation = await validateCartItems(itemsWithStringVariantId);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        // Admins (full-catalog mode) may card-pay for ANY item — a points-only
        // item is charged at 1 point = $1. Regular guests may only buy cash-priced
        // items.
        const buyerIsAdmin = await isAdmin(await getServerSession(authOptions));

        // Effective per-item cash cost: the real cash price, or (for admins) the
        // points price at 1:1 when no cash price exists.
        const itemCashCost = (i: { priceCash?: number; pricePoints?: number }): number => {
            if (i.priceCash && i.priceCash > 0) return i.priceCash;
            if (buyerIsAdmin && i.pricePoints && i.pricePoints > 0) return pointsToUsd(i.pricePoints);
            return 0;
        };

        if (!buyerIsAdmin) {
            // Every item a (non-admin) guest buys must have a cash price.
            const nonCashItem = validation.items!.find(i => !i.priceCash || i.priceCash <= 0);
            if (nonCashItem) {
                return NextResponse.json({ error: `${nonCashItem.name} isn't available for card purchase.` }, { status: 400 });
            }
        }

        const itemsCashTotal = validation.items!.reduce((sum, i) => sum + itemCashCost(i) * i.quantity, 0);

        // Reserve stock before creating the Stripe session, so two guests can't
        // both buy the last unit during the in-flight payment window. Untracked
        // variants are unlimited and always succeed. The hold is released by the
        // webhook on expiry, or committed to a sale on payment.
        const holdLines: StockLine[] = validation.items!.map(i => ({ variantId: i.variantId, quantity: i.quantity }));
        const reservation = await reserve(holdLines);
        if (!reservation.ok) {
            const oversold = validation.items!.find(i => i.variantId === reservation.variantId);
            const name = oversold?.name || 'An item';
            return NextResponse.json(
                {
                    error: reservation.available > 0
                        ? `Only ${reservation.available} of ${name} left — please reduce the quantity.`
                        : `${name} just sold out.`,
                },
                { status: 409 },
            );
        }

        // Resolve the USD shipping cost. When EasyPost is configured, the customer
        // MUST have picked a live rate from a quote we stamped for THIS cart +
        // address (validateQuotedRate re-reads the authoritative price and rejects
        // a rate id reused from a different/cheaper shipment). The flat per-country
        // fallback is ONLY used when EasyPost is off — it can't be reached by
        // omitting the rate to dodge shipping.
        let shippingCost = 0;
        let validatedRate: { carrier: string; service: string; rate: number; estDeliveryDays?: number } | null = null;
        if (isShippingConfigured()) {
            if (!selectedRate?.rateId || !selectedRate.quoteId) {
                await release(holdLines);
                return NextResponse.json(
                    { error: 'Please select a shipping option before continuing to payment.' },
                    { status: 400 },
                );
            }
            const fingerprint = cartAddressFingerprint(items, shippingAddress);
            validatedRate = await validateQuotedRate(selectedRate.quoteId, selectedRate.rateId, fingerprint);
            if (!validatedRate) {
                await release(holdLines);
                return NextResponse.json(
                    { error: 'That shipping option is no longer available. Please re-select shipping.' },
                    { status: 400 },
                );
            }
            shippingCost = validatedRate.rate;
        } else {
            const firstProduct = await getProductById(items[0].id);
            const shippingOptions = (firstProduct as any)?.shippingOptions as { country: string; cost: number }[] | undefined;
            if (shippingOptions && shippingOptions.length > 0) {
                const match = country ? shippingOptions.find(s => s.country === country) : undefined;
                const chosen = match || shippingOptions[0];
                shippingCost = typeof chosen.cost === 'number' ? chosen.cost : parseFloat(String(chosen.cost)) || 0;
            }
        }

        const stripe = getStripe();
        const taxEnabled = isStripeTaxEnabled();
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // From here on, a failure must release the stock we just reserved so a
        // crashed checkout doesn't leak held units.
        try {

        // Stripe only accepts absolute http(s) image URLs; a relative path (e.g.
        // "/images/x.svg") makes session creation fail entirely. Pass images only
        // when the thumbnail is a valid absolute URL.
        const absoluteImage = (url?: string): string | undefined =>
            url && /^https?:\/\//i.test(url) ? url : undefined;

        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = validation.items!.map(item => {
            // Stripe is the source of truth for the catalog: bill by the variant's
            // Stripe Price id when we have one. The Price already carries the USD
            // amount + tax_behavior, and its Product carries the tax_code, so Stripe
            // Tax classifies the line correctly without per-line price_data.
            //
            // BUT only when the verified amount matches the imported Price — admins
            // can pay a points-derived cash equivalent (itemCashCost differs from the
            // variant's list price_cash). If they diverge, fall back to price_data so
            // the customer is billed exactly the verified amount.
            const verifiedCents = Math.round(itemCashCost(item) * 100);
            const listCents = Math.round((item.priceCash ?? 0) * 100);
            if (item.stripePriceId && verifiedCents === listCents) {
                return { quantity: item.quantity, price: item.stripePriceId };
            }

            const img = absoluteImage(item.thumbnail_url);
            return {
                quantity: item.quantity,
                price_data: {
                    currency: 'usd',
                    unit_amount: verifiedCents,
                    // Stripe Tax: USD is tax-exclusive (US/B2B convention — tax is
                    // added on top of the price the shopper sees).
                    ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                    product_data: {
                        name: item.name,
                        ...(img ? { images: [img] } : {}),
                        // General tangible goods. Stripe Tax needs a code to classify
                        // the line; refine per-product later if a category differs.
                        ...(taxEnabled ? { tax_code: GENERAL_GOODS_TAX_CODE } : {}),
                    },
                },
            };
        });

        // The shopper already entered their shipping address on our checkout page
        // (it's what the live shipping rate was quoted against). To avoid making
        // them retype it on Stripe's page, pre-create a Customer with that address
        // and attach it to the session — Stripe then shows it pre-filled and uses
        // it for tax, so we can turn OFF Stripe's own shipping_address_collection.
        // Falls back to email-only + address collection if we don't have one.
        let customerId: string | undefined;
        if (shippingAddress && email) {
            try {
                const customer = await stripe.customers.create({
                    email,
                    name: shippingAddress.name || undefined,
                    shipping: {
                        name: shippingAddress.name || email,
                        address: {
                            line1: shippingAddress.line1,
                            line2: shippingAddress.line2 || undefined,
                            city: shippingAddress.city,
                            state: shippingAddress.state,
                            postal_code: shippingAddress.postal_code,
                            country: shippingAddress.country || 'US',
                        },
                    },
                    // Mirror to the billing address too so Stripe Tax has a jurisdiction
                    // even before the shopper touches anything.
                    address: {
                        line1: shippingAddress.line1,
                        line2: shippingAddress.line2 || undefined,
                        city: shippingAddress.city,
                        state: shippingAddress.state,
                        postal_code: shippingAddress.postal_code,
                        country: shippingAddress.country || 'US',
                    },
                });
                customerId = customer.id;
            } catch (err) {
                // Non-fatal: fall back to email-only + Stripe address collection.
                console.error('[checkout] customer pre-fill failed, falling back:', err instanceof Error ? err.message : err);
            }
        }
        const prefilled = Boolean(customerId);

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: lineItems,
            ...(customerId ? { customer: customerId } : (email ? { customer_email: email } : {})),
            ...(shippingCost > 0
                ? {
                    shipping_options: [{
                        shipping_rate_data: {
                            type: 'fixed_amount',
                            // Carrier + service so the shopper, the Stripe receipt, and
                            // the accountants all see exactly which shipping level was
                            // sold (e.g. "USPS Priority") — a separate line from the merch.
                            display_name: validatedRate
                                ? `Shipping — ${validatedRate.carrier} ${validatedRate.service}`.trim()
                                : (country ? `Shipping (${country})` : 'Shipping'),
                            fixed_amount: { amount: Math.round(shippingCost * 100), currency: 'usd' },
                            ...(taxEnabled
                                ? { tax_behavior: 'exclusive' as const, tax_code: SHIPPING_TAX_CODE }
                                : {}),
                        },
                    }],
                }
                : {}),
            // Stripe Tax needs an address for the jurisdiction. When we pre-filled a
            // Customer with the shipping address, Stripe already has it — so we do NOT
            // re-collect it (no duplicate entry), and we allow customer_update so the
            // shopper can still edit it on Stripe if needed. When we have no address,
            // fall back to collecting it on Stripe's page.
            ...(taxEnabled
                ? {
                    automatic_tax: { enabled: true },
                    ...(prefilled
                        ? { customer_update: { shipping: 'auto' as const, address: 'auto' as const } }
                        : { shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES } }),
                }
                : {}),
            success_url: `${origin}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/checkout`,
            metadata: { orderId },
        });

        const now = new Date();
        const order: Order = {
            id: orderId,
            userId: '',
            pathway: 'guest',
            paymentMethod: 'stripe',
            paymentStatus: 'unpaid',
            guestEmail: email || undefined,
            items: validation.items!.map(i => ({
                id: i.id,
                name: i.name,
                price: i.price,
                quantity: i.quantity,
                thumbnail_url: i.thumbnail_url,
                // Finance: capture variant + cost basis at sale time for COGS.
                variantId: i.variantId,
                unitCost: i.unitCost,
            })),
            subtotal: itemsCashTotal,
            pointsRequired: 0,
            pointsSpent: 0,
            shippingCost,
            // The item + shipping subtotal we know now. Stripe adds tax on top at
            // payment; the webhook writes back the final amount_total it charged.
            totalAmount: itemsCashTotal + shippingCost,
            creditsPaid: 0,
            stripeSessionId: session.id,
            shippingCountry: country,
            shippingAddress,
            inventoryHold: holdLines.filter(l => l.quantity > 0),
            // Remember the customer's chosen live rate so admin fulfillment buys
            // that exact label (not just the cheapest).
            ...(validatedRate && selectedRate
                ? {
                      shipment: {
                          carrier: validatedRate.carrier,
                          service: validatedRate.service,
                          cost: validatedRate.rate,
                          easypostShipmentId: selectedRate.shipmentId,
                          chosenRateId: selectedRate.rateId,
                          chosenAtCheckout: true,
                      },
                  }
                : {}),
            checkoutData: checkoutData || {},
            status: 'pending',
            statusHistory: [{ status: 'pending', timestamp: now }],
            createdAt: now,
        };

            await saveGuestOrder(order);

            return NextResponse.json({ url: session.url, sessionId: session.id, orderId });
        } catch (inner) {
            // Roll back the reservation — the session/order never came to be.
            await release(holdLines);
            throw inner;
        }
    } catch (error) {
        console.error('[Stripe Checkout] Error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
    }
}
