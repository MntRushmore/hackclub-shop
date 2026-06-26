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
 * thank-you page resolve the order without trusting client input. (Orders placed
 * during the HCB era have an `hcb` block instead and are resolved by id.)
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

/** Resolve a guest order from its Stripe Checkout Session id (webhook + thank-you). */
export async function getGuestOrderBySession(sessionId: string): Promise<Order | null> {
    const orderId = await redis.get<string>(`stripe:session:${sessionId}`);
    if (!orderId) return null;
    return getGuestOrder(orderId);
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

/**
 * Delete an abandoned guest order entirely. An expired Stripe checkout was never
 * paid, so it isn't a real order — remove the record plus its session pointer and
 * its entry in the buyer's email index so it never surfaces anywhere.
 */
export async function deleteGuestOrder(orderId: string): Promise<void> {
    const existing = await getGuestOrder(orderId);
    const dels: Promise<unknown>[] = [redis.del(`order:${orderId}`)];
    if (existing?.stripeSessionId) {
        dels.push(redis.del(`stripe:session:${existing.stripeSessionId}`));
    }
    if (existing?.shipment?.trackerId) {
        dels.push(redis.del(`tracker:${existing.shipment.trackerId}`));
    }
    if (existing?.guestEmail) {
        const idxKey = emailKey(existing.guestEmail);
        const ids = (await redis.get<string[]>(idxKey)) || [];
        const next = ids.filter(id => id !== orderId);
        dels.push(next.length ? redis.set(idxKey, next) : redis.del(idxKey));
    }
    await Promise.all(dels);
}
