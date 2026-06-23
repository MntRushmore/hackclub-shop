import { NextResponse } from 'next/server';
import { getGuestOrder, updateGuestOrder } from '../../../../../lib/guestOrders';
import { findDonationForOrder } from '../../../../../lib/hcb';
import { commitReserved, claimOrderSettlement } from '../../../../../lib/inventory';
import { mirrorOrder } from '../../../../../lib/airtableMirror';
import { sendEmail, buildOrderConfirmation, buildAdminNewOrder } from '../../../../../lib/email';

/**
 * Reconciler + status endpoint for the HCB guest checkout. The callback page
 * polls this with `?orderId=`. It is the trusted equivalent of the old Stripe
 * webhook: the success return is never proof of payment — payment is confirmed
 * only when a matching, settled donation shows up in the HCB v4 transactions
 * API. Idempotent and safe to hit repeatedly.
 *
 * Returns only non-sensitive fields. While the donation is still in flight this
 * reports `unpaid`; the client keeps polling until `paid`.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');
    if (!orderId) {
        return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
    }

    const order = await getGuestOrder(orderId);
    if (!order) {
        return NextResponse.json({ found: false }, { status: 404 });
    }

    // Already settled — nothing to reconcile.
    if (order.paymentStatus === 'paid') {
        return NextResponse.json({ found: true, orderId: order.id, paymentStatus: 'paid' });
    }

    // Refunded/denied orders are terminal; don't try to re-pay them.
    if (order.paymentStatus === 'refunded' || order.status === 'denied') {
        return NextResponse.json({ found: true, orderId: order.id, paymentStatus: order.paymentStatus });
    }

    try {
        const expectedCents = Math.round(order.totalAmount * 100);
        const match = await findDonationForOrder(order.id, {
            amountCents: expectedCents,
            email: order.guestEmail,
            createdAt: order.createdAt,
        });

        // HCB unreachable / not authed — transient, keep polling.
        if (match === 'unavailable') {
            return NextResponse.json({ found: true, orderId: order.id, paymentStatus: 'unpaid', pending: true });
        }
        // No matching donation yet — donor hasn't paid (or it hasn't landed).
        if (!match) {
            return NextResponse.json({ found: true, orderId: order.id, paymentStatus: 'unpaid' });
        }

        // ── Matched: finalize the order (the reconciliation the webhook used to do). ──
        // Convert the held reservation into a sale (decrements base stock). Guard
        // the commit with an atomic one-time claim so two concurrent polls can't
        // double-decrement — the paymentStatus check above is not atomic.
        if (order.inventoryHold && order.inventoryHold.length > 0) {
            if (await claimOrderSettlement(order.id)) {
                await commitReserved(order.inventoryHold);
            }
        }

        const updated = await updateGuestOrder(order.id, {
            paymentStatus: 'paid',
            status: 'approved',
            hcb: { ...(order.hcb || {}), donationTxId: match.txId, donatedAt: match.donatedAt },
            statusHistory: [
                ...order.statusHistory,
                { status: 'approved', timestamp: new Date(), message: 'Donation received via HCB' },
            ],
        });

        if (updated) {
            void mirrorOrder(updated);
            // Confirm to the customer + alert staff (no-op until email is configured).
            if (updated.guestEmail) void sendEmail(buildOrderConfirmation(updated, updated.guestEmail));
            const adminMsg = buildAdminNewOrder(updated);
            if (adminMsg) void sendEmail(adminMsg);
        }

        return NextResponse.json({ found: true, orderId: order.id, paymentStatus: 'paid' });
    } catch (error) {
        console.error('[HCB status] reconcile error:', error);
        // Don't strand the donor: report unpaid+pending so the client keeps polling;
        // a later poll (or manual staff reconciliation) will finalize it.
        return NextResponse.json({ found: true, orderId: order.id, paymentStatus: 'unpaid', pending: true });
    }
}
