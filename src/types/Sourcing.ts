/**
 * Sourcing layer types — the procurement side of the admin OS.
 *
 * The chain these model: Vendor → Quote (with quantity price-breaks) → accepted
 * Quote drafts a Product + issues a PurchaseOrder → receiving the PO posts through
 * the costing ledger (`src/lib/costing.ts`). Assets (mockups/proofs/print files)
 * attach anywhere along that chain.
 *
 * Redis is the source of truth (keys in `src/lib/sourcing.ts`); Airtable is a
 * fire-and-forget write-only mirror like everything else. See `docs/SOURCING.md`.
 *
 * Slice 1 ships Vendor + Quote. PurchaseOrder + Asset are defined here now so the
 * type surface is stable for the later slices, but are not yet wired.
 */

// ── Vendors ───────────────────────────────────────────────────────────────────

export interface Vendor {
    id: string;
    name: string;
    website?: string;
    contactName?: string;
    contactEmail?: string;
    notes?: string;          // markdown ok
    tags?: string[];         // e.g. "stickers", "apparel", "domestic"
    createdAt: string;       // ISO
    updatedAt: string;       // ISO
}

// ── Quotes ────────────────────────────────────────────────────────────────────

/** Tiered pricing: this `unitCost` applies when ordering at least `minQty`. */
export interface QuotePriceBreak {
    minQty: number;
    unitCost: number;        // USD per unit at this tier
}

export type QuoteStatus = 'open' | 'accepted' | 'rejected' | 'expired';

export interface Quote {
    id: string;
    vendorId: string;
    itemName: string;            // what's being quoted ("Vinyl sticker 3in")
    productId?: string;          // linked once a product exists (quote ↔ product)
    variantHint?: string;        // optional free text (size/color) for the pipeline
    priceBreaks: QuotePriceBreak[]; // stored sorted ascending by minQty
    moq?: number;                // minimum order quantity
    leadTimeDays?: number;
    setupFee?: number;           // one-time (screens, plates)
    shippingEstimate?: number;
    currency?: string;           // default 'USD'; flag if not
    validUntil?: string;         // ISO; expiry → command-center alert
    assetIds?: string[];         // attached art/proof (Slice 3)
    status: QuoteStatus;
    notes?: string;
    createdAt: string;           // ISO
    updatedAt: string;           // ISO
}

/**
 * Landed unit cost for a quote at a given quantity: the matching price-break unit
 * cost, plus per-unit amortized setup fee and shipping estimate. Pure helper so the
 * comparison view and the PO builder agree on the number. Returns null if the quote
 * has no usable price break at/below `qty`.
 */
export function landedUnitCost(quote: Quote, qty: number): number | null {
    if (qty <= 0) return null;
    const breaks = [...(quote.priceBreaks || [])]
        .filter((b) => typeof b.unitCost === 'number' && typeof b.minQty === 'number')
        .sort((a, b) => a.minQty - b.minQty);
    if (breaks.length === 0) return null;

    // The applicable tier is the highest minQty that is <= qty. If qty is below
    // the smallest tier, fall back to the smallest tier's price (best-effort).
    let tier = breaks[0];
    for (const b of breaks) {
        if (b.minQty <= qty) tier = b;
    }

    const setupPerUnit = quote.setupFee ? quote.setupFee / qty : 0;
    const shipPerUnit = quote.shippingEstimate ? quote.shippingEstimate / qty : 0;
    return tier.unitCost + setupPerUnit + shipPerUnit;
}

// ── Purchase Orders (Slice 4 — defined, not yet wired) ─────────────────────────

export interface POLine {
    productId: string;
    variantId: string;
    description: string;
    quantity: number;
    unitCost: number;        // captured from the accepted quote at order time
}

export type PurchaseOrderStatus =
    | 'draft'
    | 'issued'
    | 'in_transit'
    | 'received'
    | 'cancelled';

export interface PurchaseOrder {
    id: string;
    vendorId: string;
    quoteId?: string;        // provenance
    lines: POLine[];
    setupFee?: number;
    shippingCost?: number;
    status: PurchaseOrderStatus;
    expectedDate?: string;   // ISO
    receivedReceiptIds?: string[]; // links to costing.ts Receipts created on receive
    issuedBy?: string;       // admin user id
    createdAt: string;       // ISO
    updatedAt: string;       // ISO
}

// ── Assets (Slice 3 — defined, not yet wired) ──────────────────────────────────

export type AssetKind =
    | 'mockup'
    | 'proof'
    | 'print_ready'
    | 'source'
    | 'photo'
    | 'other';

export interface Asset {
    id: string;
    blobUrl: string;         // via existing Vercel Blob upload
    filename: string;
    mimeType: string;
    kind: AssetKind;
    version: number;         // increments when a newer file supersedes
    assetGroupId: string;    // stable id grouping versions of the same artwork
    label?: string;
    productId?: string;
    variantId?: string;
    quoteId?: string;
    poId?: string;
    uploadedBy: string;      // admin user id
    createdAt: string;       // ISO
}
