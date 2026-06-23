/**
 * Inventory: stock tracking + reservation across both checkout pathways.
 *
 * Read `docs/INVENTORY.md` first — it explains the model. In short:
 *   - Airtable `Products` is authoritative for the base stock number.
 *   - Redis caches that base (`inventory:{variantId}`) and holds the live
 *     `reserved` overlay (`inventory:{variantId}:reserved`) that Airtable never
 *     sees.
 *   - available = max(0, stock - reserved).
 *   - A variant with NO stock number set is unlimited (preserves legacy behaviour).
 *
 * Everything here is fire-and-forget safe like `email.ts`/`airtableMirror.ts`:
 * a Redis/Airtable hiccup degrades to "treat as available" rather than blocking a
 * purchase. The ONE exception is `reserve()`/`commitImmediate()`, which fail
 * CLOSED — they reject only when they can positively prove available < qty.
 */

import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const stockKey = (variantId: string) => `inventory:${variantId}`;
const reservedKey = (variantId: string) => `inventory:${variantId}:reserved`;

/** A unit a checkout wants to hold/sell. */
export interface StockLine {
    variantId: string;
    quantity: number;
}

interface StockCache {
    stock: number;
    syncedAt: string;
}

/**
 * Current snapshot for a variant. `stock === null` means "untracked / unlimited".
 */
export interface VariantStock {
    variantId: string;
    stock: number | null;
    reserved: number;
    available: number | null; // null when untracked (unlimited)
}

async function readStock(variantId: string): Promise<number | null> {
    try {
        const cached = await redis.get<StockCache>(stockKey(variantId));
        if (cached && typeof cached.stock === 'number') return cached.stock;
        return null;
    } catch {
        return null;
    }
}

async function readReserved(variantId: string): Promise<number> {
    try {
        const r = await redis.get<number>(reservedKey(variantId));
        return typeof r === 'number' && r > 0 ? r : 0;
    } catch {
        return 0;
    }
}

/** Snapshot of a single variant's stock/reserved/available. */
export async function getVariantStock(variantId: string): Promise<VariantStock> {
    const [stock, reserved] = await Promise.all([readStock(variantId), readReserved(variantId)]);
    const available = stock === null ? null : Math.max(0, stock - reserved);
    return { variantId, stock, reserved, available };
}

/** Snapshot for many variants at once (admin views, storefront enrichment). */
export async function getVariantStocks(variantIds: string[]): Promise<Record<string, VariantStock>> {
    const unique = Array.from(new Set(variantIds.filter(Boolean)));
    const entries = await Promise.all(unique.map(getVariantStock));
    const out: Record<string, VariantStock> = {};
    for (const e of entries) out[e.variantId] = e;
    return out;
}

/** Set/seed the cached base stock for a variant. Used by sync + admin adjust. */
export async function setStock(variantId: string, stock: number | null): Promise<void> {
    try {
        if (stock === null || Number.isNaN(stock)) {
            await redis.del(stockKey(variantId));
            return;
        }
        const cache: StockCache = { stock: Math.max(0, Math.floor(stock)), syncedAt: new Date().toISOString() };
        await redis.set(stockKey(variantId), cache);
    } catch (err) {
        console.error('[inventory] setStock failed:', err instanceof Error ? err.message : err);
    }
}

/**
 * Atomically try to reserve units for every line. Fails CLOSED: if any tracked
 * line can't be satisfied, all reservations made in this call are rolled back and
 * the conflicting line is returned. Untracked variants (no stock number) always
 * succeed. Returns { ok: true } or { ok: false, variantId, available }.
 *
 * Race-safety: we incrby reserved first (atomic), then re-read stock and verify
 * reserved <= stock. If we overshot, we decrby back. This is the standard
 * optimistic-reserve pattern and is correct without Lua because incrby is atomic.
 */
export async function reserve(lines: StockLine[]): Promise<
    { ok: true } | { ok: false; variantId: string; available: number }
> {
    const applied: StockLine[] = [];
    for (const line of lines) {
        if (line.quantity <= 0) continue;
        const stock = await readStock(line.variantId);
        if (stock === null) continue; // untracked → unlimited

        let newReserved: number;
        try {
            newReserved = await redis.incrby(reservedKey(line.variantId), line.quantity);
        } catch (err) {
            // Can't reserve safely → fail closed for this tracked line.
            console.error('[inventory] reserve incrby failed:', err instanceof Error ? err.message : err);
            await rollback(applied);
            return { ok: false, variantId: line.variantId, available: 0 };
        }

        if (newReserved > stock) {
            // Oversold — undo this line and everything before it.
            await safeDecr(line.variantId, line.quantity);
            await rollback(applied);
            const available = Math.max(0, stock - (newReserved - line.quantity));
            return { ok: false, variantId: line.variantId, available };
        }
        applied.push(line);
    }
    return { ok: true };
}

/** Release a held reservation (Stripe session expired/cancelled). Best-effort. */
export async function release(lines: StockLine[]): Promise<void> {
    await rollback(lines);
}

/**
 * Convert a held reservation into a sale: drop the reservation AND decrement the
 * cached base stock. Best-effort; also writes the new number back to Airtable so
 * the spreadsheet stays roughly current. Used by the Stripe webhook on payment.
 */
export async function commitReserved(lines: StockLine[], mirror?: (variantId: string, stock: number) => void): Promise<void> {
    for (const line of lines) {
        if (line.quantity <= 0) continue;
        await safeDecr(line.variantId, line.quantity);
        const stock = await readStock(line.variantId);
        if (stock === null) continue;
        const next = Math.max(0, stock - line.quantity);
        await setStock(line.variantId, next);
        if (mirror) mirror(line.variantId, next);
    }
}

/**
 * Decrement available stock immediately, with no reservation window. Used by the
 * student/points path (settles in-request). Fails CLOSED: returns the conflicting
 * line if a tracked variant lacks availability, decrementing nothing.
 */
export async function commitImmediate(
    lines: StockLine[],
    mirror?: (variantId: string, stock: number) => void,
): Promise<{ ok: true } | { ok: false; variantId: string; available: number }> {
    // First reserve (which does the atomic oversell check)…
    const reserved = await reserve(lines);
    if (!reserved.ok) return reserved;
    // …then immediately commit those reservations into sold stock.
    await commitReserved(lines, mirror);
    return { ok: true };
}

/**
 * Add units back to base stock — the inverse of a committed sale. Used to undo a
 * `commitImmediate` when the order fails to save (student path), and available for
 * admin refunds that should restore stock. Best-effort; untracked variants are
 * left untouched.
 */
export async function restock(lines: StockLine[]): Promise<void> {
    for (const line of lines) {
        if (line.quantity <= 0) continue;
        const stock = await readStock(line.variantId);
        if (stock === null) continue; // untracked → nothing to restore
        await setStock(line.variantId, stock + line.quantity);
    }
}

async function rollback(lines: StockLine[]): Promise<void> {
    for (const line of lines) {
        if (line.quantity > 0) await safeDecr(line.variantId, line.quantity);
    }
}

async function safeDecr(variantId: string, qty: number): Promise<void> {
    try {
        const next = await redis.decrby(reservedKey(variantId), qty);
        // Never let reserved drift negative (e.g. double-release).
        if (next < 0) await redis.set(reservedKey(variantId), 0);
    } catch (err) {
        console.error('[inventory] decr failed:', err instanceof Error ? err.message : err);
    }
}

// ── Airtable read-sync (the new read direction) ──────────────────────────────
//
// Reads each product's variant stock from the Airtable Products table and seeds
// the Redis base stock cache, WITHOUT touching the `reserved` overlay (see the
// conflict rule in docs/INVENTORY.md). Cached behind a short TTL guard so the
// storefront never hammers Airtable.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const PRODUCTS_TABLE = process.env.AIRTABLE_PRODUCTS_TABLE || 'Products';
const SYNC_GUARD_KEY = 'inventory:lastSync';
const SYNC_MIN_INTERVAL_MS = 60_000; // don't re-sync Airtable more than once a minute

export const isInventorySyncConfigured = () => Boolean(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);

interface AirtableVariant {
    variant_id?: string;
    id?: string;
    stock?: number | string;
}

interface SyncResult {
    ok: boolean;
    synced: number;       // variants whose stock was seeded
    skipped?: boolean;    // true if guarded by the min-interval
    reason?: string;
}

/**
 * Pull variant stock from Airtable → Redis base cache. `force` bypasses the
 * min-interval guard (used by the admin "Sync now" button). Never throws.
 */
export async function syncInventoryFromAirtable(force = false): Promise<SyncResult> {
    if (!isInventorySyncConfigured()) return { ok: false, synced: 0, reason: 'not_configured' };

    try {
        if (!force) {
            const last = await redis.get<number>(SYNC_GUARD_KEY);
            if (last && Date.now() - last < SYNC_MIN_INTERVAL_MS) {
                return { ok: true, synced: 0, skipped: true };
            }
        }

        let synced = 0;
        let offset: string | undefined;
        do {
            const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}`);
            if (offset) url.searchParams.set('offset', offset);
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
            });
            if (!res.ok) {
                return { ok: false, synced, reason: `Airtable ${res.status}` };
            }
            const data = (await res.json()) as { records?: { fields?: Record<string, unknown> }[]; offset?: string };

            for (const record of data.records || []) {
                const raw = record.fields?.['Variants JSON'];
                if (typeof raw !== 'string') continue;
                let variants: AirtableVariant[];
                try {
                    variants = JSON.parse(raw);
                } catch {
                    continue;
                }
                for (const v of variants) {
                    const vid = v.variant_id || v.id;
                    if (!vid) continue;
                    const stock = v.stock === undefined || v.stock === null || v.stock === '' ? null : Number(v.stock);
                    await setStock(vid, stock === null || Number.isNaN(stock) ? null : stock);
                    if (stock !== null && !Number.isNaN(stock)) synced++;
                }
            }
            offset = data.offset;
        } while (offset);

        await redis.set(SYNC_GUARD_KEY, Date.now());
        return { ok: true, synced };
    } catch (err) {
        console.error('[inventory] sync failed:', err instanceof Error ? err.message : err);
        return { ok: false, synced: 0, reason: err instanceof Error ? err.message : 'sync failed' };
    }
}
