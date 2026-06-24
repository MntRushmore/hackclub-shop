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
import { validateRate, isShippingConfigured } from '../../../../lib/shipping';
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
            selectedRate?: { rateId: string; shipmentId: string };
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

        // Resolve the USD shipping cost. If the customer picked a live EasyPost
        // rate, re-validate it SERVER-SIDE (never trust the client's price) and use
        // the authoritative amount. Otherwise fall back to the product's flat
        // per-country rate (EasyPost-off behaviour).
        let shippingCost = 0;
        let validatedRate: { carrier: string; service: string; rate: number; estDeliveryDays?: number } | null = null;
        if (selectedRate?.rateId && selectedRate.shipmentId && isShippingConfigured()) {
            validatedRate = await validateRate(selectedRate.shipmentId, selectedRate.rateId);
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
            const img = absoluteImage(item.thumbnail_url);
            return {
                quantity: item.quantity,
                price_data: {
                    currency: 'usd',
                    unit_amount: Math.round(itemCashCost(item) * 100),
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

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: lineItems,
            ...(email ? { customer_email: email } : {}),
            ...(shippingCost > 0
                ? {
                    shipping_options: [{
                        shipping_rate_data: {
                            type: 'fixed_amount',
                            display_name: validatedRate
                                ? `${validatedRate.carrier} ${validatedRate.service}`.trim()
                                : (country ? `Shipping (${country})` : 'Shipping'),
                            fixed_amount: { amount: Math.round(shippingCost * 100), currency: 'usd' },
                            ...(taxEnabled
                                ? { tax_behavior: 'exclusive' as const, tax_code: SHIPPING_TAX_CODE }
                                : {}),
                        },
                    }],
                }
                : {}),
            // Stripe Tax needs a customer address to know which jurisdiction to
            // tax. Collecting the shipping address in Checkout gives it that.
            // (NB: `customer_update` can only be passed alongside a `customer` id —
            // we only have `customer_email` here — so it must NOT be set, or
            // session creation errors. automatic_tax + address collection alone
            // are sufficient.)
            ...(taxEnabled
                ? {
                    automatic_tax: { enabled: true },
                    shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
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
