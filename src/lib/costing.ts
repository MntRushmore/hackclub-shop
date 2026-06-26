/**
 * Costing: the receiving (purchase) ledger and weighted-average cost engine.
 *
 * This is the FINANCE layer's write side. The operational unit layer
 * (`src/lib/inventory.ts`) answers "how many can we sell"; this answers "how much
 * did we pay for it". Read `docs/FINANCE.md` for the model.
 *
 * When stock is received we:
 *   1. write an append-only `Receipt` (who/what/how many/at what cost/when),
 *   2. recompute the variant's WEIGHTED-AVERAGE unit cost from the prior on-hand
 *      units+cost and the newly-received units+cost, and store it back on the
 *      variant's STRIPE PRICE metadata (`unit_cost`) — Stripe owns the catalog,
 *   3. bump the unit stock the same way (Stripe Price `stock` metadata) and keep
 *      the inventory overlay cache in step via `setStock`, so the two layers never
 *      drift,
 *   4. record an audit entry. (No Airtable mirror — that store is retired.)
 *
 * Everything is fire-and-forget safe like inventory/email: a Stripe or Redis
 * hiccup degrades gracefully and never throws into a caller. The one guard that
 * matters for correctness is idempotency — a double-submitted receipt must not
 * double-count stock or double-blend cost (see `receiveStock`).
 */

import { Redis } from '@upstash/redis';
import { setStock } from './inventory';
import { getCatalogVariant, updateVariantStripeMetadata } from './catalog';
import { recordAudit } from './auditLog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const LEDGER_KEY = 'receipts:log';            // capped list, newest first (JSON strings)
const LEDGER_MAX = 2000;
const variantIndexKey = (variantId: string) => `receipts:variant:${variantId}`;
const claimKey = (receiptId: string) => `receipts:claim:${receiptId}`;

/** A single stock-received (purchase) event. Append-only. */
export interface Receipt {
    id: string;
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    quantity: number;        // units received (> 0)
    unitCost: number;        // USD paid per unit on THIS receipt
    totalCost: number;       // quantity * unitCost, USD
    // The variant's resulting state after this receipt, for an auditable trail.
    avgCostAfter: number;    // weighted-average unit cost after blending this in
    stockAfter: number | null;
    note?: string;
    actorId: string;
    actorEmail?: string;
    receivedAt: string;      // ISO
}

export interface ReceiveInput {
    productId: string;
    variantId: string;
    quantity: number;
    unitCost: number;
    note?: string;
    actorId: string;
    actorEmail?: string;
    /** Client-supplied idempotency key so a double-submit can't double-count. */
    receiptId?: string;
}

export type ReceiveResult =
    | { ok: true; receipt: Receipt; duplicate?: false }
    | { ok: true; duplicate: true; receipt: Receipt }
    | { ok: false; error: string };

/**
 * Weighted-average blend. newAvg = (oldUnits*oldAvg + recvUnits*recvCost) /
 * (oldUnits + recvUnits). Guards div-by-zero and a missing/zero prior average
 * (untracked or never-costed variant → the received cost simply becomes the avg).
 */
export function blendCost(
    oldUnits: number,
    oldAvg: number | undefined,
    recvUnits: number,
    recvCost: number,
): number {
    const ou = Number.isFinite(oldUnits) && oldUnits > 0 ? oldUnits : 0;
    const oa = typeof oldAvg === 'number' && oldAvg >= 0 ? oldAvg : 0;
    const ru = Number.isFinite(recvUnits) && recvUnits > 0 ? recvUnits : 0;
    const rc = Number.isFinite(recvCost) && recvCost >= 0 ? recvCost : 0;
    const totalUnits = ou + ru;
    if (totalUnits <= 0) return rc; // nothing to weight by → fall back to received cost
    // If there was no prior cost basis, don't let phantom $0 units drag the avg down:
    // blend only against units that actually had a known cost.
    const oldValue = oa > 0 ? ou * oa : 0;
    const weightedUnits = oa > 0 ? ou + ru : ru;
    if (weightedUnits <= 0) return rc;
    const blended = (oldValue + ru * rc) / weightedUnits;
    return Math.round(blended * 10000) / 10000; // 4dp, avoid float drift
}

/**
 * Record a stock receipt. Updates the variant's weighted-average cost and unit
 * stock, writes the ledger entry, audits, and re-mirrors to Airtable.
 *
 * Idempotent: the first call for a given `receiptId` does the work and claims the
 * id (Redis SET NX, mirroring `claimOrderSettlement`); a duplicate delivery sees
 * the claim already taken and returns the stored receipt without re-applying the
 * stock/cost change.
 */
export async function receiveStock(input: ReceiveInput): Promise<ReceiveResult> {
    const quantity = Math.floor(Number(input.quantity));
    const unitCost = Number(input.unitCost);
    if (!input.productId || !input.variantId) return { ok: false, error: 'productId and variantId are required' };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'Quantity must be a positive whole number' };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { ok: false, error: 'Unit cost must be zero or more' };

    const receiptId = input.receiptId && /^[A-Za-z0-9_-]{1,64}$/.test(input.receiptId)
        ? input.receiptId
        : `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Idempotency claim. On a Redis error we fall through and proceed (fail open),
    // matching claimOrderSettlement — the worst case of a missed claim is a rare
    // double-count, far less bad than refusing a legitimate receipt.
    let claimed = true;
    try {
        const res = await redis.set(claimKey(receiptId), Date.now(), { nx: true, ex: 60 * 60 * 24 * 30 });
        claimed = res === 'OK';
    } catch (err) {
        console.error('[costing] claim failed (proceeding):', err instanceof Error ? err.message : err);
    }
    if (!claimed) {
        // Already applied — return the stored receipt so the caller can show it.
        const existing = await findReceiptById(receiptId);
        if (existing) return { ok: true, duplicate: true, receipt: existing };
        // Claimed but no stored receipt found (shouldn't normally happen). Treat as
        // a benign duplicate rather than re-applying.
        return { ok: false, error: 'Duplicate receipt' };
    }

    // Stripe is the source of truth for the catalog. Resolve the variant from the
    // catalog projection (stock + unitCost live in its Stripe Price metadata).
    const found = await getCatalogVariant(String(input.variantId));
    if (!found) return { ok: false, error: 'Variant not found' };
    const { product, variant } = found;

    // Prior on-hand units we blend against. A variant with no stock number is
    // "untracked/unlimited" — there's no unit base to weight by, so the received
    // cost simply becomes the new average (blendCost handles oldUnits=0).
    const priorStock = typeof variant.stock === 'number' ? variant.stock : 0;
    const priorAvg = typeof variant.unitCost === 'number' ? variant.unitCost : undefined;
    const newAvg = blendCost(priorStock, priorAvg, quantity, unitCost);

    // Only bump a real stock number. If the variant was untracked (unlimited), we
    // leave it untracked rather than silently converting it to a counted variant —
    // receiving cost data shouldn't change the sell-side availability model.
    const trackingStock = typeof variant.stock === 'number';
    const stockAfter = trackingStock ? priorStock + quantity : null;

    // Persist the new weighted-avg cost (and stock, if tracked) UP to the Stripe
    // Price metadata — Stripe owns the catalog now. The cache is refreshed inside
    // updateVariantStripeMetadata so subsequent reads see the new numbers.
    const wrote = await updateVariantStripeMetadata(String(input.variantId), {
        unitCost: newAvg,
        ...(trackingStock ? { stock: stockAfter as number } : {}),
    });
    if (!wrote) return { ok: false, error: 'Could not write cost/stock to Stripe' };

    // Keep the inventory unit cache (the live sell-side overlay base) in step with
    // the new base stock (only when tracked). This stays in Redis by design.
    if (trackingStock) await setStock(String(input.variantId), stockAfter);

    const receipt: Receipt = {
        id: receiptId,
        productId: input.productId,
        productName: product.name,
        variantId: input.variantId,
        variantName: variant.name,
        quantity,
        unitCost: Math.round(unitCost * 100) / 100,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
        avgCostAfter: newAvg,
        stockAfter,
        note: input.note?.slice(0, 500) || undefined,
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        receivedAt: new Date().toISOString(),
    };

    try {
        await redis.lpush(LEDGER_KEY, JSON.stringify(receipt));
        await redis.ltrim(LEDGER_KEY, 0, LEDGER_MAX - 1);
        await redis.lpush(variantIndexKey(input.variantId), JSON.stringify(receipt));
        await redis.ltrim(variantIndexKey(input.variantId), 0, 199);
    } catch (err) {
        // Ledger write is best-effort; the stock/cost change already landed.
        console.error('[costing] ledger write failed:', err instanceof Error ? err.message : err);
    }

    void recordAudit({
        action: 'inventory.receive',
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        target: input.variantId,
        summary: `Received ${quantity} × "${product.name} / ${variant.name}" @ $${unitCost.toFixed(2)} → avg cost $${newAvg.toFixed(2)}${stockAfter !== null ? `, stock ${stockAfter}` : ''}`,
        metadata: { receiptId, productId: input.productId, quantity, unitCost, avgCostAfter: newAvg, stockAfter },
    });

    return { ok: true, receipt };
}

function parseReceipt(raw: string | Receipt | null): Receipt | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as Receipt;
        } catch {
            return null;
        }
    }
    return raw as Receipt; // Upstash may auto-deserialize
}

/** Most recent receipts across all variants (newest first). */
export async function readReceipts(limit = 100): Promise<Receipt[]> {
    try {
        const raw = await redis.lrange<string | Receipt>(LEDGER_KEY, 0, Math.max(0, limit - 1));
        return raw.map(parseReceipt).filter((r): r is Receipt => Boolean(r && r.id));
    } catch (err) {
        console.error('[costing] readReceipts failed:', err instanceof Error ? err.message : err);
        return [];
    }
}

/** Receipt history for a single variant (newest first). */
export async function readVariantReceipts(variantId: string, limit = 100): Promise<Receipt[]> {
    try {
        const raw = await redis.lrange<string | Receipt>(variantIndexKey(variantId), 0, Math.max(0, limit - 1));
        return raw.map(parseReceipt).filter((r): r is Receipt => Boolean(r && r.id));
    } catch (err) {
        console.error('[costing] readVariantReceipts failed:', err instanceof Error ? err.message : err);
        return [];
    }
}

async function findReceiptById(id: string): Promise<Receipt | null> {
    const recent = await readReceipts(LEDGER_MAX);
    return recent.find((r) => r.id === id) || null;
}
