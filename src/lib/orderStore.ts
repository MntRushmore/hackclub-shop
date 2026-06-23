import { Redis } from '@upstash/redis';
import { Order } from '../types/Order';
import { getGuestOrder, updateGuestOrder } from './guestOrders';

/**
 * Cross-pathway order lookup/patch helpers.
 *
 * Guest (Stripe) orders are standalone under `order:${id}`. Student (points)
 * orders live inside arrays under `user:${userId}:orders`. Admin tooling that
 * acts on "an order by id" — fulfillment, shipping labels, status changes —
 * needs to resolve either shape, so that logic lives here once.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/** Look up any order by id, guest or student. */
export async function findOrder(orderId: string): Promise<Order | null> {
    const guest = await getGuestOrder(orderId);
    if (guest) return guest;
    const keys = await redis.keys('user:*:orders');
    for (const key of keys) {
        const orders = (await redis.get<Order[]>(key)) || [];
        const found = orders.find(o => o.id === orderId);
        if (found) return found;
    }
    return null;
}

/**
 * Patch arbitrary fields on any order by id (guest or student) and return the
 * updated order, or null if not found. Does not send emails or mirror — callers
 * decide on side effects.
 */
export async function patchOrder(orderId: string, patch: Partial<Order>): Promise<Order | null> {
    const guest = await getGuestOrder(orderId);
    if (guest) {
        return updateGuestOrder(orderId, patch);
    }
    const keys = await redis.keys('user:*:orders');
    for (const key of keys) {
        const orders = (await redis.get<Order[]>(key)) || [];
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx === -1) continue;
        const updated: Order = { ...orders[idx], ...patch };
        orders[idx] = updated;
        await redis.set(key, orders);
        return updated;
    }
    return null;
}

/** Best-effort email for an order: explicit guest email, else a checkoutData email. */
export function orderEmail(order: Order): string | undefined {
    if (order.guestEmail) return order.guestEmail;
    for (const v of Object.values(order.checkoutData || {})) {
        if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
    }
    return undefined;
}
