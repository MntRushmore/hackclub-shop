import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { isStructuredAddress, validateAddress } from '../../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';
import { getRates, isShippingConfigured, defaultParcelOz, stampShippingQuote } from '../../../../lib/shipping';
import { cartAddressFingerprint } from '../../../../lib/checkoutUtils';
import { ShippingAddress } from '../../../../types/Order';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Live shipping options for the checkout page. Given the cart + a destination
 * address, returns the speeds the customer can pick and pay for.
 *
 * - EasyPost configured → real carrier rates (USPS/UPS/…), sorted cheapest-first.
 *   The customer picks a speed; the chosen rate is re-validated server-side at
 *   checkout (the client price/id is never trusted).
 * - EasyPost NOT configured → the product's existing flat per-country rate, as a
 *   single option, so prod checkout keeps working until the EasyPost key is set.
 *
 * Parcel weight = sum of per-variant `weightOz` when set, else a flat default.
 */

interface RateOption {
    id: string;          // EasyPost rate id, or 'flat' for the fallback
    shipmentId?: string; // EasyPost shipment id (needed to buy the label later)
    carrier: string;
    service: string;
    cost: number;        // USD
    estDeliveryDays?: number;
}

export async function POST(request: Request) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`shipping-rates:${ip}`, { maxRequests: 20, windowMs: 60_000 });
    if (!rl.success) return rateLimitResponse();

    const { items, checkoutData, shippingCountry } = (await request.json().catch(() => ({}))) as {
        items?: { id: string; variant_id?: string | number; quantity?: number }[];
        checkoutData?: Record<string, string | ShippingAddress>;
        shippingCountry?: string;
    };
    if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'No items' }, { status: 400 });
    }

    // Pull the destination address from checkoutData if present.
    let address: ShippingAddress | undefined;
    for (const v of Object.values(checkoutData || {})) {
        if (isStructuredAddress(v)) { address = v as ShippingAddress; break; }
    }
    const country = address?.country || shippingCountry;

    // Load the first product (shipping config + weights live on the product).
    const firstProduct = await redis.get<any>(`product:${items[0].id}`);

    // ── EasyPost off → flat per-country fallback (today's prod behaviour) ──────
    if (!isShippingConfigured()) {
        const opts = (firstProduct?.shippingOptions || []) as { country: string; cost: number; costPoints?: number }[];
        const match = country ? opts.find(o => o.country === country) : undefined;
        const chosen = match || opts[0];
        const cost = chosen ? (typeof chosen.cost === 'number' ? chosen.cost : parseFloat(String(chosen.cost)) || 0) : 0;
        const flat: RateOption = { id: 'flat', carrier: 'Standard', service: 'Shipping', cost, estDeliveryDays: undefined };
        return NextResponse.json({ configured: false, options: cost > 0 || opts.length === 0 ? [flat] : [flat] });
    }

    // ── EasyPost on → live rates. Requires a valid destination address. ────────
    if (!address) {
        return NextResponse.json({ configured: true, needsAddress: true, options: [] });
    }
    const addrErrors = validateAddress(address);
    if (addrErrors.length > 0) {
        return NextResponse.json({ configured: true, needsAddress: true, options: [], error: addrErrors[0] });
    }

    // Sum parcel weight from per-variant weightOz where set, else default per unit.
    const perUnitDefault = defaultParcelOz();
    let weightOz = 0;
    for (const it of items) {
        const qty = Math.max(1, it.quantity || 1);
        const variant = (firstProduct?.variants || []).find(
            (v: any) => String(v.variant_id) === String(it.variant_id) || String(v.id) === String(it.variant_id),
        );
        const w = typeof variant?.weightOz === 'number' && variant.weightOz > 0 ? variant.weightOz : perUnitDefault;
        weightOz += w * qty;
    }

    const result = await getRates(address, { weightOz });
    if (!result.ok) {
        // EasyPost is meant to be ON here — surface the failure rather than
        // silently substituting a cheap flat rate.
        return NextResponse.json(
            { configured: true, options: [], error: 'Could not load shipping options. Please try again.' },
            { status: 502 },
        );
    }

    // EasyPost can legitimately return zero rates (unserviced address, oversize).
    // Don't dead-end the customer — fall back to the product's flat per-country
    // rate so they can still check out.
    if (result.rates.length === 0) {
        const opts = (firstProduct?.shippingOptions || []) as { country: string; cost: number }[];
        const match = country ? opts.find(o => o.country === country) : undefined;
        const chosen = match || opts[0];
        const cost = chosen ? (typeof chosen.cost === 'number' ? chosen.cost : parseFloat(String(chosen.cost)) || 0) : 0;
        const flat: RateOption = { id: 'flat', carrier: 'Standard', service: 'Shipping', cost };
        return NextResponse.json({ configured: true, options: [flat], noLiveRates: true });
    }

    // Collapse the raw carrier rates (USPS GroundAdvantage, UPSDAP 3DaySelect,
    // FEDEX_EXPRESS_SAVER, …) into at most two friendly tiers so checkout isn't a
    // wall of jargon: "Standard" (cheapest) and, when meaningfully faster, an
    // "Express" pick. Each tier still carries a real EasyPost rate id + shipmentId
    // so the chosen rate re-validates at checkout exactly as before.
    const byPrice = [...result.rates].sort((a, b) => a.rate - b.rate);
    const standard = byPrice[0];

    // Express = the fastest rate (lowest delivery days), tie-broken by price.
    // Only offer it if it's genuinely faster AND a different rate than Standard.
    const withDays = byPrice.filter(r => typeof r.estDeliveryDays === 'number');
    const fastest = withDays.length
        ? [...withDays].sort((a, b) =>
            (a.estDeliveryDays! - b.estDeliveryDays!) || (a.rate - b.rate))[0]
        : undefined;
    const express =
        fastest &&
        fastest.id !== standard.id &&
        (typeof standard.estDeliveryDays !== 'number' ||
            (fastest.estDeliveryDays ?? Infinity) < standard.estDeliveryDays)
            ? fastest
            : undefined;

    const toOption = (r: typeof standard, tier: string): RateOption => ({
        id: r.id,
        shipmentId: r.shipmentId,
        carrier: tier,        // shown as the option name (e.g. "Standard")
        service: '',          // no raw carrier service code in the UI
        cost: r.rate,
        estDeliveryDays: r.estDeliveryDays,
    });

    const options: RateOption[] = [toOption(standard, 'Standard')];
    if (express) options.push(toOption(express, 'Express'));

    // Stamp a server-side quote bound to this cart + address so checkout can
    // confirm the chosen rate was actually offered for THIS order (prevents
    // reusing a cheap/light shipment's rate id on a heavier order).
    const quoteId = randomUUID();
    const fingerprint = cartAddressFingerprint(items, address);
    await stampShippingQuote(quoteId, {
        fingerprint,
        shipmentId: result.shipmentId!,
        rateIds: options.map(o => o.id).filter(id => id !== 'flat'),
        weightOz,
    });

    return NextResponse.json({ configured: true, shipmentId: result.shipmentId, quoteId, options });
}
