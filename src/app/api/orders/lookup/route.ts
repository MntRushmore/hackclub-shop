import { NextResponse } from 'next/server';
import { lookupGuestOrder } from '../../../../lib/guestOrders';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

/**
 * Public guest order-status lookup. Guests have no account, so they prove
 * ownership with the email used at checkout + the order ref from their
 * confirmation email. Returns a sanitized view (status, items, tracking) —
 * never internal fields like the Stripe payment intent or raw checkout data.
 *
 * Rate-limited per IP to prevent enumeration of order ids against an email.
 */
export async function POST(request: Request) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limit = await rateLimit(`order-lookup:${ip}`, { maxRequests: 10, windowMs: 60_000 });
    if (!limit.success) return rateLimitResponse();

    const { email, orderRef } = (await request.json().catch(() => ({}))) as {
        email?: string;
        orderRef?: string;
    };
    if (!email || !orderRef) {
        return NextResponse.json({ error: 'Email and order number are required.' }, { status: 400 });
    }

    const order = await lookupGuestOrder(email, orderRef);
    // Same response shape whether the order is missing or the email doesn't match,
    // so the endpoint can't be used to confirm which orders exist for an email.
    if (!order) {
        return NextResponse.json({ error: 'No order found for that email and order number.' }, { status: 404 });
    }

    return NextResponse.json({
        order: {
            id: order.id,
            ref: order.id.slice(-8),
            status: order.status,
            paymentStatus: order.paymentStatus,
            createdAt: order.createdAt,
            items: order.items.map(i => ({
                name: i.name,
                quantity: i.quantity,
                price: i.price,
                thumbnail_url: i.thumbnail_url,
            })),
            totalAmount: order.totalAmount,
            shippingAddress: order.shippingAddress
                ? { city: order.shippingAddress.city, state: order.shippingAddress.state, country: order.shippingAddress.country }
                : undefined,
            shipment: order.shipment
                ? {
                      carrier: order.shipment.carrier,
                      service: order.shipment.service,
                      trackingNumber: order.shipment.trackingNumber,
                      trackingUrl: order.shipment.trackingUrl,
                      estDeliveryDate: order.shipment.estDeliveryDate,
                  }
                : undefined,
            statusHistory: (order.statusHistory || []).map(s => ({ status: s.status, timestamp: s.timestamp, message: s.message })),
        },
    });
}
