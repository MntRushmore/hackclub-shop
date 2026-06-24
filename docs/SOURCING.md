# Sourcing — Vendor & Quote Vault

The procurement side of the admin OS (Slice 1 of `ADMIN_OS_PROMPT.md`). Where merch
comes from and what it costs to source. Redis is the source of truth; Airtable is a
fire-and-forget write-only mirror, exactly like products/coupons/orders.

Shipped: **vendors + quotes + compare view** (Slice 1/2), the
**quote→product→PO→receiving pipeline** (Slice 4), the **design/art asset manager**
(Slice 3), and the **command center** action feed on `/admin` (Slice 5). The whole
program is complete.

## Entities

See `src/types/Sourcing.ts` for the authoritative definitions.

- **Vendor** — a supplier: name, website, contact, tags, notes.
- **Quote** — a price quote from one vendor for one item, with **quantity price-breaks**
  (`{ minQty, unitCost }[]`), optional MOQ, lead time, one-time setup fee, shipping
  estimate, validity date, and a status (`open` / `accepted` / `rejected` / `expired`).
  A quote optionally links to a `productId` (for the later pipeline).

## Landed unit cost (the comparison math)

`landedUnitCost(quote, qty)` in `src/types/Sourcing.ts` is the single source of truth
the UI and (later) the PO builder both use, so they never disagree:

```
landed = tierUnitCost(qty) + setupFee/qty + shippingEstimate/qty
```

- **tierUnitCost(qty)** = the unit cost of the highest price-break whose `minQty <= qty`.
  If `qty` is below the smallest tier, the smallest tier's price is used (best-effort).
- Setup fee and shipping estimate are **amortized across the compared quantity** — this is
  an approximation for decision-making, not an accounting figure (mirrors the spirit of
  the approximations documented in `docs/FINANCE.md`).
- Returns `null` if the quote has no usable price break.

The Quotes admin page groups quotes by item name and highlights the cheapest landed cost
at a chosen quantity — the actual sourcing decision tool.

## The pipeline (Slice 4): quote → product → PO → receiving

The chain that makes sourcing a *system* rather than a filing cabinet. One-directional
and idempotent at every state transition.

1. **Accept a quote** (`POST /api/admin/sourcing/quotes/{id}/accept`). Creates a
   **draft `Product`** with one variant seeded from the quote — `variant.unitCost` =
   `landedUnitCost(quote, qty)` (qty = the quote's MOQ or smallest tier), `stock: 0`,
   **no price on either pathway**. The quote is linked (`productId`) and set
   `accepted`. Optionally rejects sibling open quotes for the same item. Idempotent:
   re-accepting a quote that already has a `productId` returns the existing product.
   - **Draft safety (two independent gates):** the product has `draft: true`, which
     `/api/products` and `/api/products/[id]` exclude from the storefront; *and* it
     carries no price, so it's pathway-hidden even absent the flag. An admin publishes
     it from the Products editor (set prices, clear `draft`).
2. **Start a PO** (`POST /api/admin/sourcing/pos`) from the accepted quote (or build one
   manually). Lines = `{ productId, variantId, description, quantity, unitCost }`.
   `draft → issued → in_transit → received` (or `cancelled`).
3. **Receive** (`POST /api/admin/sourcing/pos/{id}/receive`) — **the money moment**.
   For each line it calls **`receiveStock()`** (`src/lib/costing.ts`) — the ONLY way
   stock and weighted-average cost change. Then it flips the PO to `received`.

### Idempotency of receiving (the one invariant that matters)

Each PO line receives with a **deterministic receipt id** `{poId}__{variantId}`.
`receiveStock` claims that id (`SET NX` on `receipts:claim:{id}`) and refuses to
re-apply on a duplicate. So even if "Receive" is double-clicked or the request is
retried, stock and cost basis move **exactly once per line**. We additionally guard at
the PO layer: an already-`received` PO returns early, and the created receipt ids are
stored on `po.receivedReceiptIds` for an auditable link back to the ledger. A received
PO cannot be deleted (its receipts live in the costing ledger).

Setup fee / shipping are **not** folded into landed unit cost on receive (kept simple
and exact: the ledger records the per-unit cost actually entered on each line). They are
captured on the PO for the record and shown in totals. The *amortized* landed figure is a
decision aid in the compare view only — consistent with the approximation philosophy in
`docs/FINANCE.md`.

### Permissions on the pipeline

- Accepting a quote / creating / advancing / deleting a PO: `canManageSourcing`.
- **Receiving a PO: `canManageFinance`** (it moves cost basis + inventory valuation).
  A store_manager can run procurement up to the point of receiving; a finance-trusted
  role completes it.

## Assets (Slice 3): design / art file manager

Mockups, proofs, and print-ready files, versioned and attachable to a product, quote,
and/or PO. Upload goes through Vercel Blob (a dedicated route, separate from the
product-image upload). The same artwork can appear on a quote, its resulting product,
and a PO — because the upload sets multiple target ids and each gets a reverse index.

- **Allowed types:** images (PNG/JPEG/WebP/GIF), SVG, PDF, AI/EPS, ZIP. Up to 25MB.
  Assets are downloaded/linked, never rendered inline same-origin, so vector/print
  formats are safe here (unlike the product-image upload, which excludes SVG to avoid
  stored XSS). The `AssetPanel` previews raster images as thumbnails and shows a file
  chip for everything else.
- **Versioning:** uploading a new file with an `assetGroupId` bumps `version` (one past
  the group's current max). Old versions are never deleted — proofs are records. The
  panel shows the latest per group with a version count.
- **`AssetPanel`** (`src/app/admin/sourcing/AssetPanel.tsx`) is reusable — pass one of
  `productId` / `quoteId` / `poId`. It's wired into the quotes rows and PO cards.

## Command center (Slice 5): the live action feed

`/admin` now leads with a **"Needs attention"** feed (`CommandCenter.tsx`) reading a
single aggregation endpoint `GET /api/admin/overview` — the payoff of the connected
system. Cards: reorder (variants at/below `reorderPoint`, joined to the cheapest open
quote → "start PO"), unfulfilled orders, quotes expiring within 14 days, overdue POs,
uncosted variants (finance only), and recent audit activity. The existing tool card
grid stays below as secondary nav.

- Read-only and fire-and-forget: any layer that throws degrades to an empty card.
- Role-aware: gated on `canViewStats`; sourcing cards need `canManageSourcing`, the
  uncosted-stock card needs `canManageFinance`.
- `ProductVariant.reorderPoint` drives the reorder card — set it in the product editor.

## Redis key layout

```
vendor:{id}                 → Vendor record
vendors:index               → string[] of vendor ids (newest first)
quote:{id}                  → Quote record
quotes:index                → string[] of quote ids (newest first)
quotes:vendor:{vendorId}    → string[] of quote ids for one vendor
quotes:product:{productId}  → string[] of quote ids for one product (set when linked)
po:{id}                     → PurchaseOrder record
pos:index                   → string[] of PO ids (newest first)
pos:vendor:{vendorId}       → string[] of PO ids for one vendor
asset:{id}                  → Asset record (one file version)
assets:index                → string[] of asset ids (newest first)
assets:product:{productId}  → asset ids attached to a product
assets:quote:{quoteId}      → asset ids attached to a quote
assets:po:{poId}            → asset ids attached to a PO
```

(Receiving reuses the costing ledger's keys: `receipts:log`, `receipts:variant:{id}`,
`receipts:claim:{id}` — see `src/lib/costing.ts`.)

Index lists are admin-scale and maintained read-modify-write, matching the existing
coupon/order conventions. All CRUD + index maintenance lives in `src/lib/sourcing.ts`.

## Airtable mirror (write-only, fire-and-forget)

New tables (create them in the configured base; field names Title Case). Every write
goes through the `safe()` wrapper in `src/lib/airtableMirror.ts`, so a flaky Airtable
call can never break a sourcing write. Unknown columns self-heal (dropped + retried),
same as products.

**`Vendors`** — keyed on `Vendor Id`:
`Vendor Id`, `Name`, `Website`, `Contact Name`, `Contact Email`, `Tags`, `Notes`,
`Created At`, `Updated At`.

**`Quotes`** — keyed on `Quote Id`:
`Quote Id`, `Vendor Id`, `Item Name`, `Product Id`, `Variant Hint`,
`Price Breaks JSON`, `Lowest Unit Cost`, `MOQ`, `Lead Time Days`, `Setup Fee`,
`Shipping Estimate`, `Currency`, `Valid Until`, `Status`, `Notes`,
`Created At`, `Updated At`.

**`Purchase Orders`** — keyed on `PO Id`:
`PO Id`, `Vendor Id`, `Quote Id`, `Status`, `Lines JSON`, `Line Summary`,
`Units Total`, `Setup Fee`, `Shipping Cost`, `Total Cost`, `Expected Date`,
`Received Receipt Ids`, `Issued By`, `Created At`, `Updated At`.

**`Assets`** — keyed on `Asset Id`:
`Asset Id`, `Filename`, `Label`, `Kind`, `Version`, `Group Id`, `Mime Type`, `URL`,
`Product Id`, `Variant Id`, `Quote Id`, `PO Id`, `Uploaded By`, `Created At`.

Optional env overrides (default table names shown):
`AIRTABLE_VENDORS_TABLE=Vendors`, `AIRTABLE_QUOTES_TABLE=Quotes`,
`AIRTABLE_POS_TABLE=Purchase Orders`, `AIRTABLE_ASSETS_TABLE=Assets`.

## Product additions (for the pipeline)

- `Product.draft?: boolean` — a product created from an accepted quote starts as a
  draft and is excluded from the storefront until published.
- `ProductVariant.reorderPoint?: number` — optional reorder threshold (consumed by the
  reorder intelligence / command center; does not affect checkout).

## Permissions

New permission `canManageSourcing` (`src/types/Admin.ts`):
- `manager`: true
- `store_manager`: true (can run procurement; cost basis elsewhere still gated by
  `canManageFinance`)
- `reader`: false

Enforced on **both** the page (`/api/admin/me` → `permissions.canManageSourcing`) and
every API route under `/api/admin/sourcing/`.

## Audit

Vendor/quote create/update/delete record an `auditLog` entry
(`sourcing.vendor.*`, `sourcing.quote.*`) — visible in `/admin/audit`.

## Files

| Concern | Files |
|---|---|
| Types + landed-cost helper | `src/types/Sourcing.ts` |
| Redis CRUD + indexes | `src/lib/sourcing.ts` |
| Airtable mirror | `src/lib/airtableMirror.ts` (`mirrorVendor`/`mirrorQuote` + un-) |
| API | `src/app/api/admin/sourcing/{vendors,quotes}/route.ts` + `[id]/route.ts` |
| UI | `src/app/admin/sourcing/{page,vendors/page,quotes/page}.tsx` |
| Nav | `src/app/admin/page.tsx` (Sourcing card) |
