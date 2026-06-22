import { createHash } from 'crypto';
import { Redis } from '@upstash/redis';
import { Order } from '../types/Order';

/**
 * Storage for guest (adult / Stripe) orders.
 *
 * Students' orders live under `user:${userId}:orders` (Hack Club id). Guests have
 * no account, so each order is stored standalone under `order:${orderId}` and
 * indexed by a hash of their email so they can be looked up later. A pointer from
 * the Stripe Checkout Session id to the order id lets the webhook and the
 * thank-you page resolve the order without trusting client input.
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
    if (order.stripeSessionId) {
        writes.push(redis.set(`stripe:session:${order.stripeSessionId}`, order.id));
    }

    await Promise.all(writes);
}

export async function getGuestOrder(orderId: string): Promise<Order | null> {
    return (await redis.get<Order>(`order:${orderId}`)) ?? null;
}

export async function getGuestOrderBySession(sessionId: string): Promise<Order | null> {
    const orderId = await redis.get<string>(`stripe:session:${sessionId}`);
    if (!orderId) return null;
    return getGuestOrder(orderId);
}

/** Patch an existing guest order in place (e.g. mark paid from the webhook). */
export async function updateGuestOrder(orderId: string, patch: Partial<Order>): Promise<Order | null> {
    const existing = await getGuestOrder(orderId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await redis.set(`order:${orderId}`, updated);
    return updated;
}
