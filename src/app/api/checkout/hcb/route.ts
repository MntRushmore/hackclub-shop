import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { isAdmin } from '../../../../lib/adminAuth';
import { isHcbConfigured, buildDonationUrl } from '../../../../lib/hcb';
import { validateCartItems, getProductById } from '../../../../lib/productValidation';
import { isStructuredAddress, validateAddress } from '../../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';
import { saveGuestOrder } from '../../../../lib/guestOrders';
import { reserve, release, StockLine } from '../../../../lib/inventory';
import { validateRate, isShippingConfigured } from '../../../../lib/shipping';
import { Order, ShippingAddress } from '../../../../types/Order';

/**
 * Adult / guest checkout, HCB Donations path. No login required. Prices are
 * re-derived server-side from Redis; the client-sent prices are never trusted.
 *
 * This route does NOT take payment — it creates the order in a `pending` /
 * `unpaid` state, reserves the stock, and returns a PRE-FILLED HCB donation URL
 * the donor is sent to. Payment is only confirmed later by the reconciler
 * (`GET /api/checkout/hcb/status`), which matches the donation back to this
 * order via the v4 transactions API. The success return is never treated as
 * proof of payment.
 */
export async function POST(request: Request) {
    if (!isHcbConfigured()) {
        return NextResponse.json({ error: 'Checkout is not available right now.' }, { status: 503 });
    }

    // Rate limit by IP (guests have no user id).
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`checkout:hcb:${ip}`, { maxRequests: 10, windowMs: 60000 });
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

        // Admins (full-catalog mode) may donate-pay for ANY item — a points-only
        // item is charged at 1 point = $1. Regular guests may only buy cash-priced
        // items.
        const buyerIsAdmin = await isAdmin(await getServerSession(authOptions));

        // Effective per-item cash cost: the real cash price, or (for admins) the
        // points price at 1:1 when no cash price exists.
        const itemCashCost = (i: { priceCash?: number; pricePoints?: number }): number => {
            if (i.priceCash && i.priceCash > 0) return i.priceCash;
            if (buyerIsAdmin && i.pricePoints && i.pricePoints > 0) return i.pricePoints;
            return 0;
        };

        if (!buyerIsAdmin) {
            // Every item a (non-admin) guest buys must have a cash price.
            const nonCashItem = validation.items!.find(i => !i.priceCash || i.priceCash <= 0);
            if (nonCashItem) {
                return NextResponse.json({ error: `${nonCashItem.name} isn't available for purchase.` }, { status: 400 });
            }
        }

        const itemsCashTotal = validation.items!.reduce((sum, i) => sum + itemCashCost(i) * i.quantity, 0);

        // Reserve stock before handing off to HCB, so two guests can't both buy
        // the last unit during the in-flight donation window. Untracked variants
        // are unlimited and always succeed. The hold is committed on payment by
        // the reconciler, or released if the order is abandoned/refunded.
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

        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const totalAmount = itemsCashTotal + shippingCost;

        // From here on, a failure must release the stock we just reserved so a
        // crashed checkout doesn't leak held units.
        try {
            const donateUrl = buildDonationUrl({
                amountUsd: totalAmount,
                email: email || undefined,
                name: shippingAddress?.name || undefined,
                orderId,
            });

            const now = new Date();
            const order: Order = {
                id: orderId,
                userId: '',
                pathway: 'guest',
                paymentMethod: 'hcb',
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
                totalAmount,
                creditsPaid: 0,
                hcb: { donationUrl: donateUrl },
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

            return NextResponse.json({ orderId, donateUrl });
        } catch (inner) {
            // Roll back the reservation — the order never came to be.
            await release(holdLines);
            throw inner;
        }
    } catch (error) {
        console.error('[HCB Checkout] Error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
    }
}
