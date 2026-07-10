/**
 * Donor wall + impact counters (donation pivot,
 * Slice 3 — see DONATION_PIVOT_PROMPT.md).
 *
 * Trust model matches points-are-money: every write here happens SERVER-SIDE
 * from the signature-verified Stripe webhook after payment settles. There is no
 * client-facing write endpoint — the public surface is read-only (/donors and
 * the homepage meters). All writes are best-effort (log, never throw) so a
 * Redis hiccup can't fail order settlement.
 *
 * Keys:
 *   donors:wall                 zset — score = donatedAt ms, member = JSON entry
 *   impact:total:amount         float counter, USD donated across all funds
 *   impact:total:count          int counter, number of donations
 *   impact:fund:{id}:amount     float counter, USD directed to one fund
 *   impact:fund:{id}:count      int counter
 */

import { Redis } from '@upstash/redis';
import type { Order } from '../types/Order';
import { DONATION_FUNDS } from './donation';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    // The client's default is fetch cache "no-store", which Next treats as a
    // dynamic API — it throws DynamicServerError when the homepage//donors
    // prerender (inside unstable_cache) does a read, baking zeros into the
    // static page. "default" avoids that; Upstash REST calls are POSTs, which
    // Next's fetch cache never stores, so nothing goes stale.
    cache: 'default',
});

const WALL_KEY = 'donors:wall';
const DONATION_ORDERS_KEY = 'donations:orders';

/** One row on the public wall. Stored complete; sanitized on public read. */
export interface DonorWallEntry {
    orderId: string;        // internal idempotency/debug key — stripped from public reads
    tier: string;
    fundId: string;
    amount: number;         // USD donated
    displayName?: string;
    dedication?: string;
    isAnonymous: boolean;
    // Legacy: early vest orders got a minted number (numbered-vest program,
    // retired 2026-07). Kept so old wall entries still render theirs.
    vestNumber?: number;
    donatedAt: string;      // ISO
}

export interface ImpactStats {
    totalAmount: number;
    totalCount: number;
    funds: Record<string, { amount: number; count: number }>;
}

/**
 * Write one settled donation entry to the wall + impact counters. Callers are
 * the Stripe webhook only (order payments AND Sustainer subscription starts) —
 * their idempotency guards (settlement claim / event identity) guarantee
 * exactly-once.
 */
export async function recordDonationEntry(entry: DonorWallEntry): Promise<void> {
    try {
        await redis.zadd(WALL_KEY, { score: Date.now(), member: JSON.stringify(entry) });
        await bumpImpact(entry.fundId, entry.amount);
    } catch (err) {
        console.error('[donorWall] record failed for', entry.orderId, ':', err instanceof Error ? err.message : err);
    }
}

/** Bump the impact counters only (e.g. a Sustainer's monthly renewal — no new wall entry). */
export async function bumpImpact(fundId: string, amount: number): Promise<void> {
    try {
        await Promise.all([
            redis.incrbyfloat('impact:total:amount', amount),
            redis.incr('impact:total:count'),
            redis.incrbyfloat(`impact:fund:${fundId}:amount`, amount),
            redis.incr(`impact:fund:${fundId}:count`),
        ]);
    } catch (err) {
        console.error('[donorWall] impact bump failed:', err instanceof Error ? err.message : err);
    }
}

/**
 * Record a settled donation ORDER on the wall + impact counters, and index it
 * in `donations:orders` (zset by settlement time) so the employer-match
 * follow-up cron can scan recent donations without a full order scan.
 */
export async function recordDonation(order: Order): Promise<void> {
    const d = order.donation;
    if (!d) return;
    await recordDonationEntry({
        orderId: order.id,
        tier: d.tier,
        fundId: d.fundId,
        amount: d.amount,
        displayName: d.displayName,
        dedication: d.dedication,
        isAnonymous: Boolean(d.isAnonymous),
        vestNumber: d.vestNumber,
        donatedAt: new Date().toISOString(),
    });
    try {
        await redis.zadd(DONATION_ORDERS_KEY, { score: Date.now(), member: order.id });
    } catch (err) {
        console.error('[donorWall] donation index failed for', order.id, ':', err instanceof Error ? err.message : err);
    }
}

/**
 * Public wall entries, newest first. Anonymous donors keep their tier/fund/
 * amount presence but displayName AND dedication are stripped here (the
 * dedication can name a kid), and orderId never leaves the server.
 */
export async function getDonorWall(limit = 200): Promise<Omit<DonorWallEntry, 'orderId'>[]> {
    try {
        const raw = await redis.zrange<string[]>(WALL_KEY, 0, limit - 1, { rev: true });
        return raw
            .map((m) => {
                try {
                    return typeof m === 'string' ? (JSON.parse(m) as DonorWallEntry) : (m as unknown as DonorWallEntry);
                } catch {
                    return null;
                }
            })
            .filter((e): e is DonorWallEntry => Boolean(e))
            // Explicit allowlist (not a rest-spread) so a future field added to
            // the stored entry never leaks to the public wall by default.
            .map((e) => ({
                tier: e.tier,
                fundId: e.fundId,
                amount: e.amount,
                displayName: e.isAnonymous ? undefined : e.displayName,
                dedication: e.isAnonymous ? undefined : e.dedication,
                isAnonymous: e.isAnonymous,
                vestNumber: e.vestNumber,
                donatedAt: e.donatedAt,
            }));
    } catch (err) {
        console.error('[donorWall] wall read failed:', err instanceof Error ? err.message : err);
        return [];
    }
}

/** Aggregate impact numbers for the homepage meters + /donors header. Fail-soft to zeros. */
export async function getImpactStats(): Promise<ImpactStats> {
    const zero: ImpactStats = {
        totalAmount: 0,
        totalCount: 0,
        funds: Object.fromEntries(DONATION_FUNDS.map((f) => [f.id, { amount: 0, count: 0 }])),
    };
    try {
        const keys = [
            'impact:total:amount',
            'impact:total:count',
            ...DONATION_FUNDS.flatMap((f) => [`impact:fund:${f.id}:amount`, `impact:fund:${f.id}:count`]),
        ];
        const values = await redis.mget<(string | number | null)[]>(...keys);
        const num = (v: string | number | null | undefined) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };
        const stats: ImpactStats = { ...zero, funds: { ...zero.funds } };
        stats.totalAmount = num(values[0]);
        stats.totalCount = num(values[1]);
        DONATION_FUNDS.forEach((f, i) => {
            stats.funds[f.id] = { amount: num(values[2 + i * 2]), count: num(values[3 + i * 2]) };
        });
        return stats;
    } catch (err) {
        console.error('[donorWall] impact read failed:', err instanceof Error ? err.message : err);
        return zero;
    }
}
