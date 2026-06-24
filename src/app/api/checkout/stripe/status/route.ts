import { NextResponse } from 'next/server';
import { getGuestOrderBySession } from '../../../../../lib/guestOrders';

/**
 * Public lookup for the thank-you page: given a Stripe Checkout Session id,
 * report the guest order's payment status. Returns only non-sensitive fields.
 * Payment is finalized by the webhook, so this may read `unpaid` briefly while
 * the webhook is in flight — the client polls until `paid`.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
        return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    const order = await getGuestOrderBySession(sessionId);
    if (!order) {
        return NextResponse.json({ found: false }, { status: 404 });
    }

    return NextResponse.json({
        found: true,
        orderId: order.id,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        items: order.items.map(i => ({ name: i.name, quantity: i.quantity })),
    });
}
