import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '../../../../lib/stripe';
import { getGuestOrder, getGuestOrderBySession, updateGuestOrder } from '../../../../lib/guestOrders';
import { mirrorOrder } from '../../../../lib/airtableMirror';
import { sendEmail, buildOrderConfirmation, buildAdminNewOrder } from '../../../../lib/email';
import { commitReserved, release, claimOrderSettlement } from '../../../../lib/inventory';

/**
 * Stripe webhook — the ONLY trusted signal that a guest order was paid. The
 * success redirect is never treated as proof of payment; finalization happens
 * here after verifying the signature against STRIPE_WEBHOOK_SECRET.
 */

// Stripe needs the raw, unparsed request body to verify the signature.
export const runtime = 'nodejs';

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

                // Only finalize when the money actually settled. checkout.session.
                // completed can also fire for unpaid/async-pending or $0
                // (no_payment_required) sessions; those must not flip the order to
                // paid or commit stock. (Async methods would later send
                // checkout.session.async_payment_succeeded — not handled today as
                // the shop is card-only, but this guard keeps us correct if one is
                // ever enabled.)
                if (session.payment_status !== 'paid') break;

                // Idempotent: ignore if already finalized.
                if (order.paymentStatus === 'paid') break;

                // Claim the settlement atomically (SET NX) so a duplicate or
                // concurrent delivery can't double-commit stock OR double-send the
                // confirmation/mirror — the paymentStatus check above is read-then-
                // write, not atomic across deliveries. Only the first delivery to
                // win the claim proceeds; later ones no-op here.
                if (!(await claimOrderSettlement(order.id))) break;

                // Convert the held reservation into a sale (decrements base stock).
                if (order.inventoryHold && order.inventoryHold.length > 0) {
                    await commitReserved(order.inventoryHold);
                }

                const email = order.guestEmail || session.customer_details?.email || undefined;
                // Stripe's amount_total is the authoritative charged total — with
                // Stripe Tax on, it includes sales tax that wasn't known when the
                // order was created. Write it back (and the tax line) so the order,
                // receipts, and finance reporting reflect what the customer paid.
                const amountTotal = typeof session.amount_total === 'number'
                    ? session.amount_total / 100
                    : order.totalAmount;
                const taxAmount = typeof session.total_details?.amount_tax === 'number'
                    ? session.total_details.amount_tax / 100
                    : undefined;

                const updated = await updateGuestOrder(order.id, {
                    paymentStatus: 'paid',
                    status: 'approved',
                    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
                    totalAmount: amountTotal,
                    ...(taxAmount !== undefined ? { taxAmount } : {}),
                    guestEmail: email,
                    statusHistory: [
                        ...order.statusHistory,
                        { status: 'approved', timestamp: new Date(), message: 'Payment received via Stripe' },
                    ],
                });

                if (updated) {
                    void mirrorOrder(updated);
                    // Confirm to the customer + alert staff (no-op until email is configured).
                    if (email) void sendEmail(buildOrderConfirmation(updated, email));
                    const adminMsg = buildAdminNewOrder(updated);
                    if (adminMsg) void sendEmail(adminMsg);
                }
                break;
            }
            case 'checkout.session.expired': {
                const session = event.data.object as Stripe.Checkout.Session;
                const order = await getGuestOrderBySession(session.id);
                if (order && order.paymentStatus === 'unpaid') {
                    // Free the held units — the guest never paid. Same one-time
                    // claim so a duplicate expiry can't race a late completion.
                    if (order.inventoryHold && order.inventoryHold.length > 0) {
                        if (await claimOrderSettlement(order.id)) {
                            await release(order.inventoryHold);
                        }
                    }
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
