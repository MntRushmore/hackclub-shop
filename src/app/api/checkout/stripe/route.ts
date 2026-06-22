import { NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '../../../../lib/stripe';
import { validateCartItems, getProductById } from '../../../../lib/productValidation';
import { isStructuredAddress, validateAddress } from '../../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';
import { saveGuestOrder } from '../../../../lib/guestOrders';
import { Order, ShippingAddress } from '../../../../types/Order';

/**
 * Adult / guest checkout: creates a Stripe Checkout Session for a cart paid with
 * real money. No login required. Prices are re-derived server-side from Redis;
 * the client-sent prices are never trusted. The order is created in a `pending` /
 * `unpaid` state here and only marked `paid` by the signature-verified Stripe
 * webhook — the success redirect is never treated as proof of payment.
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
        const { items, email, shippingCountry, checkoutData } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number }[];
            email?: string;
            shippingCountry?: string;
            checkoutData?: Record<string, string | ShippingAddress>;
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

        // Every item the adult buys must have a cash price.
        const nonCashItem = validation.items!.find(i => !i.priceCash || i.priceCash <= 0);
        if (nonCashItem) {
            return NextResponse.json({ error: `${nonCashItem.name} isn't available for card purchase.` }, { status: 400 });
        }

        const itemsCashTotal = validation.verifiedCashTotal!;

        // Resolve the verified USD shipping cost from the first item's product.
        let shippingCost = 0;
        const firstProduct = await getProductById(items[0].id);
        const shippingOptions = (firstProduct as any)?.shippingOptions as { country: string; cost: number }[] | undefined;
        if (shippingOptions && shippingOptions.length > 0) {
            const match = country ? shippingOptions.find(s => s.country === country) : undefined;
            const chosen = match || shippingOptions[0];
            shippingCost = typeof chosen.cost === 'number' ? chosen.cost : parseFloat(String(chosen.cost)) || 0;
        }

        const stripe = getStripe();
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Stripe only accepts absolute http(s) image URLs; a relative path (e.g.
        // "/images/x.svg") makes session creation fail entirely. Pass images only
        // when the thumbnail is a valid absolute URL.
        const absoluteImage = (url?: string): string | undefined =>
            url && /^https?:\/\//i.test(url) ? url : undefined;

        const lineItems = validation.items!.map(item => {
            const img = absoluteImage(item.thumbnail_url);
            return {
                quantity: item.quantity,
                price_data: {
                    currency: 'usd',
                    unit_amount: Math.round((item.priceCash || 0) * 100),
                    product_data: {
                        name: item.name,
                        ...(img ? { images: [img] } : {}),
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
                            display_name: country ? `Shipping (${country})` : 'Shipping',
                            fixed_amount: { amount: Math.round(shippingCost * 100), currency: 'usd' },
                        },
                    }],
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
            })),
            subtotal: itemsCashTotal,
            pointsRequired: 0,
            pointsSpent: 0,
            shippingCost,
            totalAmount: itemsCashTotal + shippingCost,
            creditsPaid: 0,
            stripeSessionId: session.id,
            shippingCountry: country,
            shippingAddress,
            checkoutData: checkoutData || {},
            status: 'pending',
            statusHistory: [{ status: 'pending', timestamp: now }],
            createdAt: now,
        };

        await saveGuestOrder(order);

        return NextResponse.json({ url: session.url, sessionId: session.id, orderId });
    } catch (error) {
        console.error('[Stripe Checkout] Error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
    }
}
