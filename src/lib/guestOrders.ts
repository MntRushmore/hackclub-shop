import { createHash } from 'crypto';
import { Redis } from '@upstash/redis';
import { Order } from '../types/Order';

/**
 * Storage for guest (adult / HCB donation) orders.
 *
 * Students' orders live under `user:${userId}:orders` (Hack Club id). Guests have
 * no account, so each order is stored standalone under `order:${orderId}` and
 * indexed by a hash of their email so they can be looked up later. The HCB
 * reconciler and callback page resolve a guest order by its id directly.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function emailKey(email: string): string {
    const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
    return `guest:${hash}:orders`;
}

export async function saveGuestOrder(order: Order): Promise<void> {
    const writes: Promise<unknown>[] = [redis.set(`order:${order.id}`, order)];

    if (order.guestEmail) {
        const idxKey = emailKey(order.guestEmail);
        const ids = (await redis.get<string[]>(idxKey)) || [];
        writes.push(redis.set(idxKey, [order.id, ...ids]));
    }

    await Promise.all(writes);
}

export async function getGuestOrder(orderId: string): Promise<Order | null> {
    return (await redis.get<Order>(`order:${orderId}`)) ?? null;
}

/**
 * Look up a guest order by email + order id, for the public order-status page.
 * Both must match: the email proves ownership (no auth), the id selects the order.
 * Accepts the full id or the 8-char short ref shown to customers.
 */
export async function lookupGuestOrder(email: string, orderRef: string): Promise<Order | null> {
    const ids = (await redis.get<string[]>(emailKey(email))) || [];
    const ref = orderRef.trim().toLowerCase();
    for (const id of ids) {
        if (id.toLowerCase() === ref || id.slice(-8).toLowerCase() === ref) {
            return getGuestOrder(id);
        }
    }
    return null;
}

/** Patch an existing guest order in place (e.g. mark paid from the webhook). */
export async function updateGuestOrder(orderId: string, patch: Partial<Order>): Promise<Order | null> {
    const existing = await getGuestOrder(orderId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await redis.set(`order:${orderId}`, updated);
    return updated;
}
