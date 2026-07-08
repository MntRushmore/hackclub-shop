import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { isAdmin } from '../../../../lib/adminAuth';
import {
    getStripe,
    isStripeConfigured,
    isStripeTaxEnabled,
    resolveStripeMode,
    getActiveTaxRegistrationStates,
    GENERAL_GOODS_TAX_CODE,
    SHIPPING_TAX_CODE,
    NONTAXABLE_TAX_CODE,
} from '../../../../lib/stripe';
import { pointsToUsd } from '../../../../lib/paymentUtils';
import { sanitizeDonationInput, deductibleCents, type DonationCheckoutInput } from '../../../../lib/donation';
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
    if (!isStripeConfigured('live') && !isStripeConfigured('test')) {
        return NextResponse.json({ error: 'Card payments are not available right now.' }, { status: 503 });
    }

    // Rate limit by IP (guests have no user id).
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`checkout:stripe:${ip}`, { maxRequests: 10, windowMs: 60000 });
    if (!rl.success) return rateLimitResponse();

    try {
        const { items, email, shippingCountry, checkoutData, selectedRate, donation } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number }[];
            email?: string;
            shippingCountry?: string;
            checkoutData?: Record<string, string | ShippingAddress>;
            selectedRate?: { rateId: string; shipmentId: string; quoteId?: string };
            // Donor-provided fields (fund choice, dedication, donor-wall name).
            // Only honored when the verified cart actually contains donation tiers.
            donation?: DonationCheckoutInput;
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
        const authSession = await getServerSession(authOptions);
        const buyerIsAdmin = await isAdmin(authSession);

        // Which Stripe key slot this checkout charges through: the signed-in
        // admin's personal override if set, otherwise the store-wide mode.
        // Fail closed if the resolved slot's key is missing — never silently
        // charge through the other account.
        const mode = await resolveStripeMode(authSession);
        if (!isStripeConfigured(mode)) {
            return NextResponse.json({ error: 'Card payments are not available right now.' }, { status: 503 });
        }

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

        // Two-pick donation tiers (donation.giftPicks = 2, e.g. the Founders
        // Circle): the donor's second gift arrives as donation.secondGiftVariantId.
        // Resolve it against the same product's catalog variants, fold it into
        // the verified line (fulfillment name + cost basis) and hold its stock
        // alongside pick one. The price is untouched — both pieces are the one
        // tier's thank-you gift.
        let secondGiftHold: StockLine | null = null;
        let secondGiftName: string | undefined;
        // Split-line billing needs the picks' own identities, so remember the
        // primary pick's name (before the fulfillment-name merge below) and the
        // second pick's declared FMV/tax classification.
        let twoPickPrimaryName: string | undefined;
        let secondGiftMeta: { name: string; fmvCents?: number; taxCode?: string } | null = null;
        const twoPickItem = validation.items!.find(i => (i.donation?.giftPicks ?? 1) > 1);
        if (twoPickItem) {
            const rawSecond = typeof donation?.secondGiftVariantId === 'string' ? donation.secondGiftVariantId.trim() : '';
            const tierProduct = rawSecond ? await getProductById(twoPickItem.id) : null;
            const second = tierProduct?.variants.find(v => String(v.variant_id || v.id) === rawSecond);
            if (!second) {
                return NextResponse.json({ error: 'Please pick your second thank-you gift.' }, { status: 400 });
            }
            if (String(second.variant_id || second.id) === twoPickItem.variantId) {
                return NextResponse.json({ error: 'Please pick two different pieces for your thank-you gifts.' }, { status: 400 });
            }
            twoPickPrimaryName = twoPickItem.name;
            twoPickItem.name = `${twoPickItem.name} + ${second.name}`;
            if (typeof second.unitCost === 'number' && second.unitCost >= 0) {
                twoPickItem.unitCost = (twoPickItem.unitCost ?? 0) + second.unitCost;
            }
            secondGiftMeta = { name: second.name, fmvCents: second.fmvCents, taxCode: second.taxCode };
            secondGiftName = second.name;
            secondGiftHold = { variantId: String(second.variant_id || second.id), quantity: twoPickItem.quantity };
        }

        // Reserve stock before creating the Stripe session, so two guests can't
        // both buy the last unit during the in-flight payment window. Untracked
        // variants are unlimited and always succeed. The hold is released by the
        // webhook on expiry, or committed to a sale on payment.
        const holdLines: StockLine[] = [
            ...validation.items!.map(i => ({ variantId: i.variantId, quantity: i.quantity })),
            ...(secondGiftHold ? [secondGiftHold] : []),
        ];
        const reservation = await reserve(holdLines);
        if (!reservation.ok) {
            const oversold = validation.items!.find(i => i.variantId === reservation.variantId);
            const name = oversold?.name
                || (secondGiftHold && reservation.variantId === secondGiftHold.variantId ? secondGiftName : undefined)
                || 'An item';
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

        const stripe = getStripe(mode);
        const taxEnabled = isStripeTaxEnabled(mode);

        // Donor experience: a thank-you gift shouldn't wear a price tag. The
        // gift-FMV lines exist so Stripe Tax can tax the goods portion — which
        // only happens in states with an active tax registration. When the
        // shipping address is provably OUTSIDE every registered state, the
        // whole tier bills as ONE donation line (gift named, no amount) and
        // the FMV stays internal (order record + IRS receipt disclosure).
        // Itemize whenever tax is on and the state is registered, the address
        // is unknown (Stripe collects it on its page), or the registration
        // list couldn't be read — over-disclosing is safe, under-collecting
        // tax is not.
        let itemizeGiftFmv = taxEnabled;
        if (taxEnabled && shippingAddress?.country?.toUpperCase() === 'US' && shippingAddress.state) {
            const registered = await getActiveTaxRegistrationStates(mode);
            if (registered !== null && !registered.includes(shippingAddress.state.toUpperCase())) {
                itemizeGiftFmv = false;
            }
        }
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

        // Donation tiers: the verified cash price is the DONATION amount; only the
        // thank-you gift's fair market value is a sale of goods. Each chosen gift
        // becomes its OWN FMV line (own declared value + own tax code — e.g. an
        // exempt vest next to a taxable mug) when the variant carries a declared
        // per-gift fmvCents; otherwise one combined line at the tier-level FMV.
        // Totals are clamped into [0, verified amount] so a misconfigured FMV can
        // never bill more than the verified price or go negative.
        interface GiftFmvPart { name: string; fmvCents: number; taxCode?: string }
        const giftFmvParts = (
            item: NonNullable<typeof validation.items>[number],
            verifiedCents: number,
        ): GiftFmvPart[] => {
            const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v)), max);
            const isTwoPick = item === twoPickItem && secondGiftMeta !== null;
            if (isTwoPick && typeof item.fmvCents === 'number' && typeof secondGiftMeta!.fmvCents === 'number') {
                const fmv1 = clamp(item.fmvCents, verifiedCents);
                const fmv2 = clamp(secondGiftMeta!.fmvCents!, verifiedCents - fmv1);
                return [
                    { name: twoPickPrimaryName || item.name, fmvCents: fmv1, taxCode: item.taxCode },
                    { name: secondGiftMeta!.name, fmvCents: fmv2, taxCode: secondGiftMeta!.taxCode },
                ];
            }
            // Single pick: the gift's declared FMV wins over the tier-level one.
            // Combined two-pick fallback (a pick lacks a declared FMV): tier-level
            // FMV on one line; if the picks classify differently, drop to the
            // general (taxable) code — over-collecting a little beats under-
            // collecting a tax liability.
            const fmv = clamp(
                !isTwoPick && typeof item.fmvCents === 'number' ? item.fmvCents : (item.donation?.fmvCents ?? 0),
                verifiedCents,
            );
            const taxCode = isTwoPick && (secondGiftMeta!.taxCode || undefined) !== item.taxCode
                ? undefined
                : item.taxCode;
            return [{ name: item.name, fmvCents: fmv, taxCode }];
        };
        const giftFmvCents = (item: NonNullable<typeof validation.items>[number], verifiedCents: number): number =>
            giftFmvParts(item, verifiedCents).reduce((s, p) => s + p.fmvCents, 0);

        // Donor input is honored only when the verified cart contains donation
        // tiers. The optional extra amount (custom giving above the tier price,
        // e.g. Founder's Circle + extra = any total over $1,000) is sanitized to
        // an integer cent amount within the cap — it's client-chosen money, but
        // a donor overpaying on purpose is the point; the floor is 0.
        const donationItems = validation.items!.filter(i => i.donation);
        const donor = donationItems.length > 0 ? sanitizeDonationInput(donation) : null;
        const extraCents = donor?.extraCents ?? 0;
        const extraUsd = extraCents / 100;

        // Monthly giving: the tier bills as a subscription. The thank-you gift
        // still ships once (stock is held exactly like a one-time order), the
        // FMV disclosure applies to the first payment, and renewals bump the
        // impact meters via the invoice.paid webhook. Mixing a subscription
        // with ordinary shop items in one Stripe session isn't supported.
        const wantsRecurring = Boolean(donor?.recurring);
        if (wantsRecurring && donationItems.length !== validation.items!.length) {
            await release(holdLines);
            return NextResponse.json(
                { error: 'Monthly donations can’t be combined with other shop items in one checkout.' },
                { status: 400 },
            );
        }

        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = validation.items!.flatMap(item => {
            // A one-time donation-tier line is billed via price_data, split in
            // two: the gift's FMV as a taxable goods line, and everything above
            // it as a nontaxable donation. (Billing by the Stripe Price id would
            // classify the whole amount as goods and tax the donation.)
            // A MONTHLY donation-tier line is a single recurring nontaxable
            // line for the full amount; FMV is disclosed on the receipt.
            if (item.donation) {
                const verifiedCents = Math.round(itemCashCost(item) * 100);
                if (wantsRecurring) {
                    return [{
                        quantity: item.quantity,
                        price_data: {
                            currency: 'usd',
                            unit_amount: verifiedCents,
                            recurring: { interval: 'month' as const },
                            ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                            product_data: {
                                name: `${item.donation.tier} monthly donation to Hack Club`,
                                ...(taxEnabled ? { tax_code: NONTAXABLE_TAX_CODE } : {}),
                            },
                        },
                    }];
                }
                const img = absoluteImage(item.thumbnail_url);

                // No tax to compute at this destination: one clean donation
                // line, the gift named but never priced. FMV still lands on
                // the order (giftFmvParts below) for accounting + the receipt.
                if (!itemizeGiftFmv) {
                    return [{
                        quantity: item.quantity,
                        price_data: {
                            currency: 'usd',
                            unit_amount: verifiedCents,
                            ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                            product_data: {
                                name: `${item.donation.tier} donation to Hack Club`,
                                description: `Includes ${item.name} as our thank-you gift.`,
                                ...(img ? { images: [img] } : {}),
                                ...(taxEnabled ? { tax_code: NONTAXABLE_TAX_CODE } : {}),
                            },
                        },
                    }];
                }

                const fmvParts = giftFmvParts(item, verifiedCents);
                const fmvCents = fmvParts.reduce((s, p) => s + p.fmvCents, 0);
                const donationCents = verifiedCents - fmvCents;
                const split: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
                for (const [i, part] of fmvParts.entries()) {
                    if (part.fmvCents <= 0) continue;
                    split.push({
                        quantity: item.quantity,
                        price_data: {
                            currency: 'usd',
                            unit_amount: part.fmvCents,
                            ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                            product_data: {
                                name: `${part.name} (thank-you gift)`,
                                ...(i === 0 && img ? { images: [img] } : {}),
                                // Each gift's own classification (apparel is
                                // tax-exempt in e.g. Vermont); general goods when unset.
                                ...(taxEnabled ? { tax_code: part.taxCode || GENERAL_GOODS_TAX_CODE } : {}),
                            },
                        },
                    });
                }
                if (donationCents > 0) {
                    split.push({
                        quantity: item.quantity,
                        price_data: {
                            currency: 'usd',
                            unit_amount: donationCents,
                            ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                            product_data: {
                                name: `${item.donation.tier} donation to Hack Club`,
                                ...(taxEnabled ? { tax_code: NONTAXABLE_TAX_CODE } : {}),
                            },
                        },
                    });
                }
                return split;
            }
            return [buildRetailLineItem(item)];
        });

        // The donor's extra donation rides as its own pure-donation line: no
        // gift attached, so it's fully deductible and nontaxable.
        if (extraCents > 0) {
            lineItems.push({
                quantity: 1,
                price_data: {
                    currency: 'usd',
                    unit_amount: extraCents,
                    ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                    product_data: {
                        name: 'Additional donation to Hack Club',
                        ...(taxEnabled ? { tax_code: NONTAXABLE_TAX_CODE } : {}),
                    },
                },
            });
        }

        function buildRetailLineItem(item: NonNullable<typeof validation.items>[number]): Stripe.Checkout.SessionCreateParams.LineItem {
            // Stripe is the source of truth for the catalog: bill by the variant's
            // Stripe Price id when we have one. The Price already carries the USD
            // amount + tax_behavior, and its Product carries the tax_code, so Stripe
            // Tax classifies the line correctly without per-line price_data.
            //
            // BUT only when the verified amount matches the imported Price — admins
            // can pay a points-derived cash equivalent (itemCashCost differs from the
            // variant's list price_cash). If they diverge, fall back to price_data so
            // the customer is billed exactly the verified amount.
            // Catalog Price ids live in the LIVE account — they don't exist in
            // test mode, so a test checkout always bills inline price_data.
            const verifiedCents = Math.round(itemCashCost(item) * 100);
            const listCents = Math.round((item.priceCash ?? 0) * 100);
            if (mode === 'live' && item.stripePriceId && verifiedCents === listCents) {
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
                        // The variant's own classification (apparel vs general
                        // goods); the general tangible-goods code when unset.
                        ...(taxEnabled ? { tax_code: item.taxCode || GENERAL_GOODS_TAX_CODE } : {}),
                    },
                },
            };
        }

        // Donation summary for the order: totals across donation-tier lines plus
        // the extra amount plus the donor's sanitized fund/dedication/wall-name
        // input. The receipt email renders this as the IRS acknowledgment.
        let orderDonation: Order['donation'];
        if (donationItems.length > 0 && donor) {
            let amountCents = extraCents;
            let fmvTotalCents = 0;
            for (const i of donationItems) {
                const verifiedCents = Math.round(itemCashCost(i) * 100);
                amountCents += verifiedCents * i.quantity;
                fmvTotalCents += giftFmvCents(i, verifiedCents) * i.quantity;
            }
            // Label the order with the largest single donation line's tier.
            const biggest = donationItems.reduce((a, b) => (itemCashCost(b) > itemCashCost(a) ? b : a));
            orderDonation = {
                tier: biggest.donation!.tier,
                fundId: donor.fundId,
                amount: amountCents / 100,
                fmvAmount: fmvTotalCents / 100,
                deductibleAmount: deductibleCents(amountCents, fmvTotalCents) / 100,
                ...(donor.dedication ? { dedication: donor.dedication } : {}),
                ...(donor.displayName ? { displayName: donor.displayName } : {}),
                isAnonymous: donor.isAnonymous,
                ...(wantsRecurring ? { recurring: true } : {}),
            };
        }

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

        const shippingName = validatedRate
            ? `Shipping (${validatedRate.carrier} ${validatedRate.service})`.trim()
            : (country ? `Shipping (${country})` : 'Shipping');
        // Subscription mode doesn't support shipping_options, so a monthly
        // donation's one-time gift shipping bills as a plain first-invoice line.
        if (wantsRecurring && shippingCost > 0) {
            lineItems.push({
                quantity: 1,
                price_data: {
                    currency: 'usd',
                    unit_amount: Math.round(shippingCost * 100),
                    ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
                    product_data: {
                        name: shippingName,
                        ...(taxEnabled ? { tax_code: SHIPPING_TAX_CODE } : {}),
                    },
                },
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: wantsRecurring ? 'subscription' : 'payment',
            line_items: lineItems,
            ...(customerId ? { customer: customerId } : (email ? { customer_email: email } : {})),
            ...(!wantsRecurring && shippingCost > 0
                ? {
                    shipping_options: [{
                        shipping_rate_data: {
                            type: 'fixed_amount',
                            // Carrier + service so the shopper, the Stripe receipt, and
                            // the accountants all see exactly which shipping level was
                            // sold (e.g. "USPS Priority") — a separate line from the merch.
                            display_name: shippingName,
                            fixed_amount: { amount: Math.round(shippingCost * 100), currency: 'usd' },
                            ...(taxEnabled
                                ? { tax_behavior: 'exclusive' as const, tax_code: SHIPPING_TAX_CODE }
                                : {}),
                        },
                    }],
                }
                : {}),
            // Renewal invoices carry this metadata so the invoice.paid webhook
            // can bump the impact meters without another Stripe read.
            ...(wantsRecurring && donor
                ? { subscription_data: { metadata: { donation: '1', fund: donor.fundId, orderId } } }
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
            // Expire the session quickly (Stripe's minimum is 30 min) so abandoned
            // checkouts release their inventory hold and get cleaned up promptly via
            // the checkout.session.expired webhook, instead of sitting ~24h.
            expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
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
            // Includes any extra donation, which bills as its own Stripe line.
            subtotal: itemsCashTotal + extraUsd,
            pointsRequired: 0,
            pointsSpent: 0,
            shippingCost,
            // The item + extra + shipping subtotal we know now. Stripe adds tax on
            // top at payment; the webhook writes back the final amount_total.
            totalAmount: itemsCashTotal + extraUsd + shippingCost,
            creditsPaid: 0,
            ...(orderDonation ? { donation: orderDonation } : {}),
            stripeSessionId: session.id,
            stripeMode: mode,
            // Test-mode orders are junk data by definition: stamping isTest makes
            // stats, finance, the warehouse queue, and the donor wall ignore them.
            ...(mode === 'test' ? { isTest: true } : {}),
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
            // Placeholder until payment settles. It stays 'unpaid', and the admin
            // list hides unpaid guest orders, so this never shows as a real order.
            // The webhook flips it to 'received' on payment, or deletes it on expiry.
            status: 'received',
            statusHistory: [{ status: 'received', timestamp: now }],
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
