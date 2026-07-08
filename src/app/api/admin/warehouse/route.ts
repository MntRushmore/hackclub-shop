import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { isShippingConfigured, defaultParcelOz } from '../../../../lib/shipping';
import { getVariantStocks } from '../../../../lib/inventory';
import type { Order } from '../../../../types/Order';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Admin-only: everything the warehouse needs to work a shift.
 *  - `shipFrom`: the origin address labels ship from (SHIP_FROM_* env), with any
 *    missing required fields called out — rate quotes and labels fail without them
 *  - `queue`: paid orders waiting to ship (status 'received', tests excluded),
 *    oldest first, with the ship-to address and the shipping level the customer
 *    already paid for
 *  - `pickList`: the queue's items aggregated per variant with on-hand counts,
 *    so stock gets pulled in one pass instead of order by order
 *
 * Gated on canViewStats (the same permission that exposes the order list).
 */

// Ship-from fields EasyPost requires on a domestic label.
const REQUIRED_FROM = ['street1', 'city', 'state', 'zip'] as const;

export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');
    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // ── Origin address (mirrors fromAddress() in lib/shipping.ts) ──
    const shipFromFields = {
        name: process.env.SHIP_FROM_NAME || 'Hack Club Shop',
        company: process.env.SHIP_FROM_COMPANY || null,
        street1: process.env.SHIP_FROM_STREET1 || null,
        street2: process.env.SHIP_FROM_STREET2 || null,
        city: process.env.SHIP_FROM_CITY || null,
        state: process.env.SHIP_FROM_STATE || null,
        zip: process.env.SHIP_FROM_ZIP || null,
        country: process.env.SHIP_FROM_COUNTRY || 'US',
        phone: process.env.SHIP_FROM_PHONE || null,
    };
    const missing = REQUIRED_FROM.filter((f) => !shipFromFields[f]);

    // ── Collect orders from both stores (same layout the stats route reads) ──
    const orders: Order[] = [];
    const userKeys = await redis.keys('user:*:orders');
    for (const key of userKeys) {
        const userOrders = await redis.get<Order[]>(key);
        if (userOrders) orders.push(...userOrders);
    }
    const guestKeys = await redis.keys('order:*');
    for (const key of guestKeys) {
        const order = await redis.get<Order>(key);
        if (order) orders.push(order);
    }

    // The ship queue: real, paid, not yet shipped. Unpaid guest rows are Stripe
    // sessions still in flight (or abandoned), not orders.
    const queue = orders
        .filter((o) => o.status === 'received' && !o.isTest && o.paymentStatus !== 'unpaid')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((o) => ({
            id: o.id,
            pathway: o.pathway,
            buyer: o.pathway === 'guest' ? o.guestEmail || '' : o.userId,
            createdAt: o.createdAt,
            shippingAddress: o.shippingAddress || null,
            items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, variantId: i.variantId || null })),
            // The shipping level the customer chose and paid for at checkout —
            // the warehouse buys exactly this label.
            paidShipping: o.shipment && !o.shipment.trackingNumber && (o.shipment.carrier || o.shipment.service)
                ? { carrier: o.shipment.carrier || '', service: o.shipment.service || '', cost: o.shipment.cost ?? null }
                : null,
            vestNumber: o.donation?.vestNumber ?? null,
        }));

    // ── Pick list: aggregate queue lines per variant (fall back to name) ──
    const byKey = new Map<string, { variantId: string | null; name: string; quantity: number; orders: number }>();
    for (const o of queue) {
        for (const item of o.items) {
            const key = item.variantId || `name:${item.name}`;
            const row = byKey.get(key) || { variantId: item.variantId, name: item.name, quantity: 0, orders: 0 };
            row.quantity += item.quantity;
            row.orders += 1;
            byKey.set(key, row);
        }
    }
    const stocks = await getVariantStocks(
        Array.from(byKey.values(), (r) => r.variantId).filter((v): v is string => Boolean(v)),
    );
    const pickList = Array.from(byKey.values())
        .map((r) => ({
            ...r,
            onHand: r.variantId ? stocks[r.variantId]?.stock ?? null : null,
        }))
        .sort((a, b) => b.quantity - a.quantity);

    return NextResponse.json({
        shipFrom: { ...shipFromFields, configured: missing.length === 0, missing },
        easypostConfigured: isShippingConfigured(),
        defaultParcelOz: defaultParcelOz(),
        queue,
        pickList,
        generatedAt: new Date().toISOString(),
    });
}
