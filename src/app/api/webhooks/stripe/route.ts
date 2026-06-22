import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '../../../../lib/stripe';
import { getGuestOrder, getGuestOrderBySession, updateGuestOrder } from '../../../../lib/guestOrders';
import { mirrorOrder } from '../../../../lib/airtableMirror';
import { Order } from '../../../../types/Order';

/**
 * Stripe webhook — the ONLY trusted signal that a guest order was paid. The
 * success redirect is never treated as proof of payment; finalization happens
 * here after verifying the signature against STRIPE_WEBHOOK_SECRET.
 */

// Stripe needs the raw, unparsed request body to verify the signature.
export const runtime = 'nodejs';

async function notifySlack(order: Order) {
    try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/slack/notify-purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId: order.id,
                userId: order.guestEmail || 'guest',
                userEmail: order.guestEmail || '',
                items: order.items.map(i => ({ name: i.name, price: parseFloat(i.price) || 0, quantity: i.quantity })),
                subtotal: order.subtotal,
                totalAmount: order.totalAmount,
                shippingCost: order.shippingCost,
                shippingCountry: order.shippingCountry,
                checkoutData: order.checkoutData,
                newBalance: 0,
            }),
        });
    } catch (err) {
        console.error('[Stripe webhook] Slack notify failed:', err);
    }
}

export async function POST(request: Request) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET not set');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const sig = request.headers.get('stripe-signature');
    if (!sig) {
        return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const rawBody = await request.text();

    let event: Stripe.Event;
    try {
        event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
        console.error('[Stripe webhook] Signature verification failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const orderId = session.metadata?.orderId;

                // Resolve the order by metadata first, then by the session-id pointer.
                let order = orderId ? await getGuestOrder(orderId) : null;
                if (!order) order = await getGuestOrderBySession(session.id);
                if (!order) {
                    console.error('[Stripe webhook] No order for session', session.id);
                    break;
                }

                // Idempotent: ignore if already finalized.
                if (order.paymentStatus === 'paid') break;

                const email = order.guestEmail || session.customer_details?.email || undefined;
                const updated = await updateGuestOrder(order.id, {
                    paymentStatus: 'paid',
                    status: 'approved',
                    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
                    guestEmail: email,
                    statusHistory: [
                        ...order.statusHistory,
                        { status: 'approved', timestamp: new Date(), message: 'Payment received via Stripe' },
                    ],
                });

                if (updated) {
                    void mirrorOrder(updated);
                    void notifySlack(updated);
                }
                break;
            }
            case 'checkout.session.expired': {
                const session = event.data.object as Stripe.Checkout.Session;
                const order = await getGuestOrderBySession(session.id);
                if (order && order.paymentStatus === 'unpaid') {
                    await updateGuestOrder(order.id, { status: 'denied' });
                }
                break;
            }
            default:
                // Ignore unrelated event types.
                break;
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('[Stripe webhook] Handler error:', error);
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }
}
