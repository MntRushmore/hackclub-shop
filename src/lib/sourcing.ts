/**
 * Sourcing: Redis CRUD + index maintenance for vendors and quotes.
 *
 * This is the write/read side of the procurement vault (Slice 1 of the admin OS).
 * Redis is the source of truth; Airtable is a fire-and-forget mirror (the API
 * routes call the mirror, this module stays storage-only). See `docs/SOURCING.md`.
 *
 * Key layout (mirrors the product/coupon/order conventions already in the app):
 *   vendor:{id}                 — the Vendor record
 *   vendors:index               — array of vendor ids (newest first)
 *   quote:{id}                  — the Quote record
 *   quotes:index                — array of quote ids (newest first)
 *   quotes:vendor:{vendorId}    — array of quote ids for one vendor
 *   quotes:product:{productId}  — array of quote ids for one product (set on link)
 *   po:{id}                     — the PurchaseOrder record
 *   pos:index                   — array of PO ids (newest first)
 *   pos:vendor:{vendorId}       — array of PO ids for one vendor
 *   asset:{id}                  — the Asset record (one file version)
 *   assets:index                — array of asset ids (newest first)
 *   assets:product:{productId}  — asset ids attached to a product
 *   assets:quote:{quoteId}      — asset ids attached to a quote
 *   assets:po:{poId}            — asset ids attached to a PO
 *
 * Index lists are small (admin-scale) so a read-modify-write array is fine and
 * matches how coupons/orders are handled elsewhere. Reads tolerate Upstash's
 * occasional auto-deserialization of JSON values.
 *
 * Receiving a PO is the one correctness-sensitive path: it posts each line through
 * `receiveStock()` (the costing ledger) with a DETERMINISTIC receipt id, so a
 * double "mark received" can't double-count stock or double-blend cost. See
 * `receivePO`.
 */

import { Redis } from '@upstash/redis';
import {
    Vendor,
    Quote,
    QuotePriceBreak,
    PurchaseOrder,
    POLine,
    PurchaseOrderStatus,
    Asset,
    AssetKind,
} from '../types/Sourcing';
import { receiveStock } from './costing';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const vendorKey = (id: string) => `vendor:${id}`;
const VENDORS_INDEX = 'vendors:index';
const quoteKey = (id: string) => `quote:${id}`;
const QUOTES_INDEX = 'quotes:index';
const quotesVendorKey = (vendorId: string) => `quotes:vendor:${vendorId}`;
const quotesProductKey = (productId: string) => `quotes:product:${productId}`;
const poKey = (id: string) => `po:${id}`;
const POS_INDEX = 'pos:index';
const posVendorKey = (vendorId: string) => `pos:vendor:${vendorId}`;
const assetKey = (id: string) => `asset:${id}`;
const ASSETS_INDEX = 'assets:index';
const assetsProductKey = (productId: string) => `assets:product:${productId}`;
const assetsQuoteKey = (quoteId: string) => `assets:quote:${quoteId}`;
const assetsPoKey = (poId: string) => `assets:po:${poId}`;

function newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
    return new Date().toISOString();
}

/** Read an id-list index, newest first. Tolerant of missing/garbage values. */
async function readIndex(key: string): Promise<string[]> {
    try {
        const ids = await redis.get<string[]>(key);
        return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

/** Add an id to the front of an index (idempotent — no duplicates). */
async function indexPrepend(key: string, id: string): Promise<void> {
    const ids = await readIndex(key);
    if (ids.includes(id)) return;
    await redis.set(key, [id, ...ids]);
}

async function indexRemove(key: string, id: string): Promise<void> {
    const ids = await readIndex(key);
    if (!ids.includes(id)) return;
    await redis.set(key, ids.filter((x) => x !== id));
}

/** Resolve a list of records from an id index, dropping any that 404. */
async function getMany<T>(keyFor: (id: string) => string, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) {
        try {
            const rec = await redis.get<T>(keyFor(id));
            if (rec) out.push(rec);
        } catch {
            // skip
        }
    }
    return out;
}

// ── Vendors ───────────────────────────────────────────────────────────────────

export type VendorInput = Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>;

export async function createVendor(input: VendorInput): Promise<Vendor> {
    const now = nowIso();
    const vendor: Vendor = {
        id: newId('vendor'),
        ...input,
        tags: input.tags || [],
        createdAt: now,
        updatedAt: now,
    };
    await redis.set(vendorKey(vendor.id), vendor);
    await indexPrepend(VENDORS_INDEX, vendor.id);
    return vendor;
}

export async function getVendor(id: string): Promise<Vendor | null> {
    try {
        return (await redis.get<Vendor>(vendorKey(id))) || null;
    } catch {
        return null;
    }
}

export async function listVendors(): Promise<Vendor[]> {
    const ids = await readIndex(VENDORS_INDEX);
    return getMany<Vendor>(vendorKey, ids);
}

export async function updateVendor(
    id: string,
    patch: Partial<VendorInput>,
): Promise<Vendor | null> {
    const existing = await getVendor(id);
    if (!existing) return null;
    const updated: Vendor = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
    };
    await redis.set(vendorKey(id), updated);
    return updated;
}

export async function deleteVendor(id: string): Promise<void> {
    await redis.del(vendorKey(id));
    await indexRemove(VENDORS_INDEX, id);
}

// ── Quotes ────────────────────────────────────────────────────────────────────

export type QuoteInput = Omit<Quote, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
    status?: Quote['status'];
};

/** Sort price breaks ascending by minQty, drop malformed entries. */
function normalizeBreaks(breaks: QuotePriceBreak[] | undefined): QuotePriceBreak[] {
    return [...(breaks || [])]
        .filter((b) => typeof b?.minQty === 'number' && typeof b?.unitCost === 'number')
        .sort((a, b) => a.minQty - b.minQty);
}

export async function createQuote(input: QuoteInput): Promise<Quote> {
    const now = nowIso();
    const quote: Quote = {
        id: newId('quote'),
        ...input,
        priceBreaks: normalizeBreaks(input.priceBreaks),
        status: input.status || 'open',
        createdAt: now,
        updatedAt: now,
    };
    await redis.set(quoteKey(quote.id), quote);
    await indexPrepend(QUOTES_INDEX, quote.id);
    await indexPrepend(quotesVendorKey(quote.vendorId), quote.id);
    if (quote.productId) await indexPrepend(quotesProductKey(quote.productId), quote.id);
    return quote;
}

export async function getQuote(id: string): Promise<Quote | null> {
    try {
        return (await redis.get<Quote>(quoteKey(id))) || null;
    } catch {
        return null;
    }
}

export async function listQuotes(): Promise<Quote[]> {
    const ids = await readIndex(QUOTES_INDEX);
    return getMany<Quote>(quoteKey, ids);
}

export async function listQuotesByVendor(vendorId: string): Promise<Quote[]> {
    const ids = await readIndex(quotesVendorKey(vendorId));
    return getMany<Quote>(quoteKey, ids);
}

export async function listQuotesByProduct(productId: string): Promise<Quote[]> {
    const ids = await readIndex(quotesProductKey(productId));
    return getMany<Quote>(quoteKey, ids);
}

export async function updateQuote(
    id: string,
    patch: Partial<QuoteInput>,
): Promise<Quote | null> {
    const existing = await getQuote(id);
    if (!existing) return null;
    const updated: Quote = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
        priceBreaks: patch.priceBreaks
            ? normalizeBreaks(patch.priceBreaks)
            : existing.priceBreaks,
    };
    await redis.set(quoteKey(id), updated);

    // Keep the vendor/product reverse indexes consistent if those links changed.
    if (patch.vendorId && patch.vendorId !== existing.vendorId) {
        await indexRemove(quotesVendorKey(existing.vendorId), id);
        await indexPrepend(quotesVendorKey(updated.vendorId), id);
    }
    if (patch.productId !== undefined && patch.productId !== existing.productId) {
        if (existing.productId) await indexRemove(quotesProductKey(existing.productId), id);
        if (updated.productId) await indexPrepend(quotesProductKey(updated.productId), id);
    }
    return updated;
}

export async function deleteQuote(id: string): Promise<void> {
    const existing = await getQuote(id);
    await redis.del(quoteKey(id));
    await indexRemove(QUOTES_INDEX, id);
    if (existing) {
        await indexRemove(quotesVendorKey(existing.vendorId), id);
        if (existing.productId) await indexRemove(quotesProductKey(existing.productId), id);
    }
}

// ── Purchase Orders ────────────────────────────────────────────────────────────

export type POInput = {
    vendorId: string;
    quoteId?: string;
    lines: POLine[];
    setupFee?: number;
    shippingCost?: number;
    expectedDate?: string;
    issuedBy?: string;
    status?: PurchaseOrderStatus;
};

function normalizeLines(lines: POLine[] | undefined): POLine[] {
    return [...(lines || [])]
        .map((l) => ({
            productId: String(l.productId || ''),
            variantId: String(l.variantId || ''),
            description: String(l.description || ''),
            quantity: Math.floor(Number(l.quantity)),
            unitCost: Number(l.unitCost),
        }))
        .filter(
            (l) =>
                l.productId &&
                l.variantId &&
                Number.isFinite(l.quantity) &&
                l.quantity > 0 &&
                Number.isFinite(l.unitCost) &&
                l.unitCost >= 0,
        );
}

export async function createPO(input: POInput): Promise<PurchaseOrder> {
    const now = nowIso();
    const po: PurchaseOrder = {
        id: newId('po'),
        vendorId: input.vendorId,
        quoteId: input.quoteId,
        lines: normalizeLines(input.lines),
        setupFee: input.setupFee,
        shippingCost: input.shippingCost,
        status: input.status || 'draft',
        expectedDate: input.expectedDate,
        receivedReceiptIds: [],
        issuedBy: input.issuedBy,
        createdAt: now,
        updatedAt: now,
    };
    await redis.set(poKey(po.id), po);
    await indexPrepend(POS_INDEX, po.id);
    await indexPrepend(posVendorKey(po.vendorId), po.id);
    return po;
}

export async function getPO(id: string): Promise<PurchaseOrder | null> {
    try {
        return (await redis.get<PurchaseOrder>(poKey(id))) || null;
    } catch {
        return null;
    }
}

export async function listPOs(): Promise<PurchaseOrder[]> {
    const ids = await readIndex(POS_INDEX);
    return getMany<PurchaseOrder>(poKey, ids);
}

export async function listPOsByVendor(vendorId: string): Promise<PurchaseOrder[]> {
    const ids = await readIndex(posVendorKey(vendorId));
    return getMany<PurchaseOrder>(poKey, ids);
}

/** Persist a PO record as-is (used to advance status / store receipt ids). */
async function savePO(po: PurchaseOrder): Promise<PurchaseOrder> {
    const updated = { ...po, updatedAt: nowIso() };
    await redis.set(poKey(po.id), updated);
    return updated;
}

const PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
    draft: ['issued', 'cancelled'],
    issued: ['in_transit', 'received', 'cancelled'],
    in_transit: ['received', 'cancelled'],
    received: [],
    cancelled: [],
};

export type POStatusResult =
    | { ok: true; po: PurchaseOrder }
    | { ok: false; error: string };

/**
 * Advance a PO's status along the allowed lifecycle. `received` is NOT set here —
 * that only happens through `receivePO`, which must post stock first.
 */
export async function setPOStatus(
    id: string,
    status: PurchaseOrderStatus,
): Promise<POStatusResult> {
    const po = await getPO(id);
    if (!po) return { ok: false, error: 'Purchase order not found' };
    if (status === 'received') {
        return { ok: false, error: 'Use receivePO to mark a PO received' };
    }
    if (po.status === status) return { ok: true, po };
    if (!PO_TRANSITIONS[po.status]?.includes(status)) {
        return { ok: false, error: `Cannot move a ${po.status} PO to ${status}` };
    }
    const saved = await savePO({ ...po, status });
    return { ok: true, po: saved };
}

export type ReceivePOResult =
    | { ok: true; po: PurchaseOrder; receiptIds: string[]; alreadyReceived?: boolean }
    | { ok: false; error: string };

/**
 * Receive a PO in full: post every line through the costing ledger and flip the PO
 * to `received`. THE idempotency contract:
 *
 *   - Each line gets a deterministic receipt id `{poId}__{variantId}`. `receiveStock`
 *     claims that id (SET NX) and refuses to re-apply on a duplicate — so even if
 *     this runs twice, stock and weighted-avg cost only move once per line.
 *   - We additionally guard at the PO layer: a PO already `received` returns early,
 *     and we record the receipt ids we created on the PO for an auditable link.
 *
 * If a line fails to post we keep going (collecting the error) rather than leaving a
 * half-received PO silently — the caller surfaces partial failures. A PO is only
 * flipped to `received` when at least one line posted and no line errored.
 */
export async function receivePO(
    id: string,
    actor: { actorId: string; actorEmail?: string },
): Promise<ReceivePOResult> {
    const po = await getPO(id);
    if (!po) return { ok: false, error: 'Purchase order not found' };
    if (po.status === 'cancelled') return { ok: false, error: 'Cannot receive a cancelled PO' };
    if (po.status === 'received') {
        return { ok: true, po, receiptIds: po.receivedReceiptIds || [], alreadyReceived: true };
    }
    if (po.lines.length === 0) return { ok: false, error: 'PO has no lines to receive' };

    const receiptIds: string[] = [];
    const errors: string[] = [];

    for (const line of po.lines) {
        // Deterministic id → idempotent across retries (claimed in receiveStock).
        const receiptId = `${po.id}__${line.variantId}`;
        const res = await receiveStock({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            note: `PO ${po.id}${po.quoteId ? ` (quote ${po.quoteId})` : ''}`,
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            receiptId,
        });
        if (res.ok) {
            receiptIds.push(res.receipt.id);
        } else {
            errors.push(`${line.description || line.variantId}: ${res.error}`);
        }
    }

    if (receiptIds.length === 0) {
        return { ok: false, error: `Nothing received — ${errors.join('; ')}` };
    }

    const saved = await savePO({
        ...po,
        status: errors.length === 0 ? 'received' : po.status,
        receivedReceiptIds: Array.from(new Set([...(po.receivedReceiptIds || []), ...receiptIds])),
    });

    if (errors.length > 0) {
        return { ok: false, error: `Partially received (${receiptIds.length}/${po.lines.length}) — ${errors.join('; ')}` };
    }
    return { ok: true, po: saved, receiptIds };
}

export async function deletePO(id: string): Promise<void> {
    const existing = await getPO(id);
    await redis.del(poKey(id));
    await indexRemove(POS_INDEX, id);
    if (existing) await indexRemove(posVendorKey(existing.vendorId), id);
}

// ── Assets (design / art files) ────────────────────────────────────────────────

export type AssetInput = {
    blobUrl: string;
    filename: string;
    mimeType: string;
    kind: AssetKind;
    label?: string;
    productId?: string;
    variantId?: string;
    quoteId?: string;
    poId?: string;
    uploadedBy: string;
    /** When set, this upload is a new VERSION of an existing asset group. */
    assetGroupId?: string;
};

/** Maintain the three reverse indexes for an asset's attachment targets. */
async function linkAsset(asset: Asset): Promise<void> {
    if (asset.productId) await indexPrepend(assetsProductKey(asset.productId), asset.id);
    if (asset.quoteId) await indexPrepend(assetsQuoteKey(asset.quoteId), asset.id);
    if (asset.poId) await indexPrepend(assetsPoKey(asset.poId), asset.id);
}

async function unlinkAsset(asset: Asset): Promise<void> {
    if (asset.productId) await indexRemove(assetsProductKey(asset.productId), asset.id);
    if (asset.quoteId) await indexRemove(assetsQuoteKey(asset.quoteId), asset.id);
    if (asset.poId) await indexRemove(assetsPoKey(asset.poId), asset.id);
}

/**
 * Create an asset record for an already-uploaded blob. If `assetGroupId` is given,
 * this is a new version of that group — `version` is set to one past the current max
 * in the group (we never delete old versions; proofs are records).
 */
export async function createAsset(input: AssetInput): Promise<Asset> {
    const assetGroupId = input.assetGroupId || newId('agrp');

    let version = 1;
    if (input.assetGroupId) {
        const siblings = (await listAllAssets()).filter((a) => a.assetGroupId === input.assetGroupId);
        version = siblings.reduce((max, a) => Math.max(max, a.version), 0) + 1;
    }

    const asset: Asset = {
        id: newId('asset'),
        blobUrl: input.blobUrl,
        filename: input.filename,
        mimeType: input.mimeType,
        kind: input.kind,
        version,
        assetGroupId,
        label: input.label,
        productId: input.productId,
        variantId: input.variantId,
        quoteId: input.quoteId,
        poId: input.poId,
        uploadedBy: input.uploadedBy,
        createdAt: nowIso(),
    };

    await redis.set(assetKey(asset.id), asset);
    await indexPrepend(ASSETS_INDEX, asset.id);
    await linkAsset(asset);
    return asset;
}

export async function getAsset(id: string): Promise<Asset | null> {
    try {
        return (await redis.get<Asset>(assetKey(id))) || null;
    } catch {
        return null;
    }
}

async function listAllAssets(): Promise<Asset[]> {
    const ids = await readIndex(ASSETS_INDEX);
    return getMany<Asset>(assetKey, ids);
}

export async function listAssetsByProduct(productId: string): Promise<Asset[]> {
    return getMany<Asset>(assetKey, await readIndex(assetsProductKey(productId)));
}

export async function listAssetsByQuote(quoteId: string): Promise<Asset[]> {
    return getMany<Asset>(assetKey, await readIndex(assetsQuoteKey(quoteId)));
}

export async function listAssetsByPO(poId: string): Promise<Asset[]> {
    return getMany<Asset>(assetKey, await readIndex(assetsPoKey(poId)));
}

export async function deleteAsset(id: string): Promise<void> {
    const existing = await getAsset(id);
    await redis.del(assetKey(id));
    await indexRemove(ASSETS_INDEX, id);
    if (existing) await unlinkAsset(existing);
}
