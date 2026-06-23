import { Redis } from '@upstash/redis';

/**
 * Lightweight admin audit log for money/points/stock-affecting actions.
 *
 * These are real-value operations (refunds, point grants, order status changes,
 * shipping labels, stock edits), so we keep an append-only trail of who did what,
 * when, to which target. Stored as a capped Redis list (`audit:log`) — newest
 * first, trimmed to the most recent N entries so it never grows unbounded.
 *
 * Fire-and-forget like the other side-effect layers: `void recordAudit(...)`.
 * A logging failure must never break the action it's recording.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KEY = 'audit:log';
const MAX_ENTRIES = 1000;

export type AuditAction =
    | 'order.approve'
    | 'order.deny'
    | 'order.fulfill'
    | 'order.refund'
    | 'order.mark-test'
    | 'order.unmark-test'
    | 'order.ship'
    | 'points.grant'
    | 'points.deduct'
    | 'inventory.adjust'
    | 'inventory.receive';

export interface AuditEntry {
    id: string;
    action: AuditAction;
    actorId: string;          // admin user id
    actorEmail?: string;
    target?: string;          // order id / user id / variant id
    summary: string;          // human-readable one-liner
    metadata?: Record<string, unknown>;
    timestamp: string;        // ISO
}

/** Append an audit entry. Never throws. */
export async function recordAudit(
    entry: Omit<AuditEntry, 'id' | 'timestamp'> & { timestamp?: string },
): Promise<void> {
    try {
        const full: AuditEntry = {
            id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            timestamp: entry.timestamp || new Date().toISOString(),
            ...entry,
        };
        await redis.lpush(KEY, JSON.stringify(full));
        await redis.ltrim(KEY, 0, MAX_ENTRIES - 1);
    } catch (err) {
        console.error('[audit] record failed:', err instanceof Error ? err.message : err);
    }
}

/** Read the most recent audit entries (newest first). */
export async function readAudit(limit = 100): Promise<AuditEntry[]> {
    try {
        const raw = await redis.lrange<string | AuditEntry>(KEY, 0, Math.max(0, limit - 1));
        return raw
            .map((r) => {
                if (typeof r === 'string') {
                    try {
                        return JSON.parse(r) as AuditEntry;
                    } catch {
                        return null;
                    }
                }
                // Upstash may auto-deserialize JSON values.
                return r as AuditEntry;
            })
            .filter((e): e is AuditEntry => Boolean(e && e.id));
    } catch (err) {
        console.error('[audit] read failed:', err instanceof Error ? err.message : err);
        return [];
    }
}
