# Hack Club Shop — Admin OS Spec ("Everything Connected")

> The next track after the four shipped in `SHOP_UPGRADE_PROMPT.md`. Where that spec made the
> storefront good, this one turns the **admin from a set of CRUD screens into a connected
> operations system**: sourcing flows into the catalog and the costing ledger, art assets ride
> the whole chain, and a single command center reads from all of it.
>
> Written against the actual codebase (Next.js 13 App Router · TypeScript · Tailwind · Upstash
> Redis source-of-truth · Airtable write-only mirror · Vercel Blob · NextAuth/Hack Club OAuth ·
> HCB Donations + EasyPost). **Read `SHOP_UPGRADE_PROMPT.md`, `docs/FINANCE.md`,
> `docs/INVENTORY.md`, and `src/lib/costing.ts` before starting** — this spec extends them and
> must not regress them.

---

## 0. Context the implementer must hold

The shop already has a real operational backbone. This track plugs *into* it; it does not
rebuild it.

**What already exists (reuse, don't reinvent):**

| Capability | Where | Reuse it for |
|---|---|---|
| Weighted-avg cost + append-only receiving ledger | `src/lib/costing.ts` (`Receipt`, `receiveStock`) | A received PO must post **through `receiveStock`** so cost basis stays consistent. Don't write a second costing path. |
| Inventory units + reservations | `src/lib/inventory.ts` (`setStock`, `getVariantStocks`, `available`) | Reorder signals read available/on-hand from here. |
| Finance read aggregations | `src/lib/finance.ts` (`loadAllOrders`, periods) | Sales velocity for reorder intelligence; command-center finance alerts. |
| Dual-priced product + variant model | `src/types/Admin.ts` (`Product`, `ProductVariant.unitCost`) | Quote→Product writes a draft `Product`; an accepted quote line seeds `variant.unitCost`. |
| Airtable write-only mirror (fire-and-forget) | `src/lib/airtableMirror.ts` (`upsert`, `safe`, self-healing field drop) | New entities (Vendors, Quotes, POs) mirror to Airtable the **same way** — copy the `safe()`/`upsert()` pattern exactly. |
| Audit log | `src/lib/auditLog.ts` (`recordAudit`) | Every money/inventory/sourcing mutation records an audit entry. |
| Permission gates | `src/types/Admin.ts` (`AdminPermissions`, `ROLE_PERMISSIONS`) | New `canManageSourcing` permission, gated on page **and** API route. |
| Blob uploads | `src/app/api/admin/upload/` + `@vercel/blob` | Art assets and quote attachments store here; reuse the existing upload route/pattern. |
| Email / Slack-id lookup | `src/lib/email.ts`, `user:{id}:slackId` | (Command center can surface, but customer comms is explicitly out of scope this track — see §7.) |

**Data conventions (match these exactly):**
- **Upstash Redis is the source of truth.** New entities follow the established key shapes:
  `vendor:{id}`, `vendors:index` (a set/array of ids), `quote:{id}`, `quotes:index`,
  `quote:vendor:{vendorId}` (index), `po:{id}`, `pos:index`, `asset:{id}`, plus reverse
  indexes (`assets:product:{productId}`, `quotes:product:{productId}`). Mirror the
  list-index + per-entity-record layout already used for products/coupons/orders.
- **Airtable is a fire-and-forget, write-only mirror.** New tables: `Vendors`, `Quotes`,
  `Purchase Orders`, `Assets`. Field names Title Case. **Every mirror call goes through the
  `safe()` wrapper** so a flaky Airtable call can never break a sourcing write. New columns
  documented in `docs/SOURCING.md` (you create it).
- **IDs:** generate the same way existing entities do (check `products`/`coupons` routes for
  the id scheme — do not introduce a new uuid library if one isn't already used).
- **Money is USD, stored as numbers; round with the existing `round2` helper pattern.**

**Non-negotiable invariants (do not regress):**
1. **Receiving a PO posts through `receiveStock()`** — never write `variant.unitCost` or bump
   stock directly. The weighted-average blend and idempotency (`receipts:claim:{id}`) are the
   whole point of the finance layer.
2. **Idempotency on every state transition.** Marking a PO received twice must not double-count
   stock or double-blend cost (lean on the existing claim-key pattern).
3. **Airtable / Blob / email failures never throw into a write path** — fire-and-forget, logged,
   swallowed, exactly like `airtableMirror.ts` / `inventory.ts`.
4. **Permission gates enforced on BOTH page and API route** for every new admin action
   (`canManageSourcing`, and `canManageFinance` for anything exposing cost basis).
5. **Audit everything that moves money or stock** via `recordAudit` (quote accepted, PO issued,
   PO received, cost overridden).
6. **No secrets/quotes/cost basis leak to non-finance roles or the storefront.** Vendor pricing
   is internal-only; nothing here renders on a public route.

---

## 1. Goals (what "everything connected" means here)

A staffer can: **save a vendor → log a quote (with quantity price-breaks, lead time, MOQ, and
attached art/proof) → compare competing quotes for the same item → accept one, which drafts a
product and issues a purchase order → receive that PO, which posts to the costing ledger and
bumps inventory automatically → and see, on one home screen, everything that needs action.**

Four connected tracks, each independently shippable. Prefer small verifiable PRs over a
mega-change. Preserve Hack Club brand identity (Phantom Sans, the palette, the playful polish).

---

## 2. SOURCING — Vendor + Quote Vault (the headline)

Today there is no place to record where merch comes from or what it costs to source. Build it.

**Entities (new types in `src/types/Sourcing.ts`):**

```ts
interface Vendor {
  id: string;
  name: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;            // markdown ok
  tags?: string[];           // e.g. "stickers", "apparel", "domestic"
  createdAt: string;
  updatedAt: string;
}

interface QuotePriceBreak {        // tiered pricing
  minQty: number;                  // this price applies at >= minQty
  unitCost: number;                // USD per unit at this tier
}

interface Quote {
  id: string;
  vendorId: string;
  itemName: string;                // what's being quoted ("Vinyl sticker 3in")
  productId?: string;              // linked once a product exists (quote↔product)
  variantHint?: string;            // optional free text (size/color) for the pipeline
  priceBreaks: QuotePriceBreak[];  // sorted ascending by minQty
  moq?: number;                    // minimum order quantity
  leadTimeDays?: number;
  setupFee?: number;               // one-time (screens, plates) — amortized note only
  shippingEstimate?: number;
  currency?: string;               // default 'USD'; convert/flag if not
  validUntil?: string;             // quote expiry → command-center alert
  assetIds?: string[];             // attached art/proof (see §5)
  status: 'open' | 'accepted' | 'rejected' | 'expired';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Functionality:**
- **CRUD for vendors and quotes** — `src/lib/sourcing.ts` (Redis read/write + index maintenance),
  API under `src/app/api/admin/sourcing/{vendors,quotes}/...`, pages under
  `src/app/admin/sourcing/`. Gate everything on `canManageSourcing`.
- **Quote comparison view**: select an item / `productId` and see every quote for it
  side-by-side — landed unit cost at a chosen quantity (price-break + amortized setup fee +
  shipping estimate), lead time, MOQ, and which vendor. Highlight the cheapest at the chosen qty.
  This is the decision tool; make it genuinely useful, not a raw table.
- **Mirror to Airtable** `Vendors` and `Quotes` tables via the `safe()`/`upsert()` pattern, so
  non-engineers can browse them. JSON columns for `priceBreaks`/`assetIds` like the product
  mirror does for variants.

**Acceptance:** A staffer can save two vendors, log a quote from each for "3in vinyl sticker"
with quantity price-breaks, open the comparison view at qty 500, and instantly see which is
cheaper landed. Vendors and quotes appear in Airtable within the mirror's normal lag.

---

## 3. PIPELINE — Quote → Product → Purchase Order → Receiving (the connective tissue)

This is what makes it a *system* instead of a filing cabinet. The chain must be one-directional
and idempotent.

**Quote → Product:**
- From an `open` quote, **"Accept & create product"**: drafts a `Product` (reusing the existing
  product create path / validation in `src/lib/productValidation.ts`) with a variant seeded from
  the quote (`variant.unitCost` = unit cost at the quote's MOQ or a chosen tier; `variantHint`
  → size/color). Product starts **unpublished/draft** (add a `draft` flag to `Product` if one
  doesn't exist; drafts never render on `/shop` — verify against the storefront filter). Sets
  `quote.productId` and `quote.status = 'accepted'`; records audit.
- Accepting one quote for an item offers to mark sibling quotes `rejected` (don't force it).

**Purchase Orders (new `src/types/Sourcing.ts` `PurchaseOrder`):**

```ts
interface POLine {
  productId: string;
  variantId: string;
  description: string;
  quantity: number;
  unitCost: number;          // captured from the accepted quote at order time
}
interface PurchaseOrder {
  id: string;
  vendorId: string;
  quoteId?: string;          // provenance
  lines: POLine[];
  setupFee?: number;
  shippingCost?: number;
  status: 'draft' | 'issued' | 'in_transit' | 'received' | 'cancelled';
  expectedDate?: string;
  receivedReceiptIds?: string[];  // links to costing.ts Receipts created on receive
  createdAt: string;
  updatedAt: string;
  issuedBy?: string;
}
```

- **Generate a PO from an accepted quote** (or build one manually): pick quantities per line at a
  price-break tier; PO shows landed unit cost and total. `draft → issued → in_transit → received`.
- **Receiving is the money moment.** On **"Mark received"** (full or partial per line), for each
  received line call **`receiveStock()`** from `src/lib/costing.ts` — this is the ONLY way stock
  and cost basis update. Store the returned receipt ids on the PO (`receivedReceiptIds`) so the PO
  is idempotent: receiving the same line twice is a no-op (guard with the existing claim-key, plus
  a PO-level guard). Allocate `setupFee`/`shippingCost` into landed unit cost per the rule you
  document in `docs/SOURCING.md` (recommend: amortize across received units; note it as an
  approximation like `docs/FINANCE.md` does).
- Mirror `Purchase Orders` to Airtable; record audit on issue and on receive.
- Optional polish: a printable/exportable PO view (HTML print stylesheet is enough; no PDF lib).

**Acceptance:** Accept a quote → a draft product + variant exist with the quoted unit cost →
generate and issue a PO for 500 units → mark received → the variant's on-hand stock rises by 500,
its weighted-average `unitCost` reflects the blend, a `Receipt` exists in the ledger, the finance
dashboard's inventory value moves accordingly, and marking received again changes nothing.

---

## 4. COMMAND CENTER — one home screen of everything needing action

Replace today's static `/admin` card grid (`src/app/admin/page.tsx`) with a **live ops home** that
reads across the existing layers and surfaces what needs a human. Keep the card grid as secondary
navigation below the action feed; don't delete working navigation.

**An aggregation API** `src/app/api/admin/overview/` (gated; respects role — finance numbers only
for `canManageFinance`) returns a single payload of action items. Build each card from data that
already exists:

- **Low stock / reorder** — from `inventory.ts` available vs. a per-variant reorder point
  (add optional `reorderPoint` to `ProductVariant`); cross-reference sales velocity from
  `finance.ts` to rank urgency. Each item links to the cheapest open quote for that product (the
  sourcing↔inventory join) and offers **"start PO"**.
- **Orders needing action** — pending/approved-unfulfilled, from the orders layer (reuse the
  orders route's filters); unfulfilled count, oldest age.
- **Quotes expiring soon** — `quote.validUntil` within N days, status `open`.
- **POs in transit / overdue** — `expectedDate` passed, status not `received`.
- **Finance alerts** — uncosted variants (no `unitCost`), negative-margin SKUs, this-week cash vs.
  COGS delta (all already computable from `finance.ts`).
- **Recent audit activity** — last N `recordAudit` entries for situational awareness.

Make it scannable: counts + the top few items per card, each row deep-linking to the right admin
page with the right filter pre-applied. This screen is the payoff of "everything connected" — it
only works because the layers above feed it.

**Acceptance:** Landing on `/admin` shows, without clicking, that e.g. 3 variants are below reorder
point (one with a cheap open quote ready to PO), 2 orders are unfulfilled >5 days, 1 quote expires
this week, and 4 variants are uncosted — each a working link. Finance rows are hidden from a
`store_manager` role.

---

## 5. ASSETS — Design / art asset manager (rides the whole chain)

Mockups, proofs, and print-ready files, versioned and attached wherever they're relevant.

**Entity (`src/types/Sourcing.ts` `Asset`):**

```ts
interface Asset {
  id: string;
  blobUrl: string;           // via existing Vercel Blob upload
  filename: string;
  mimeType: string;
  kind: 'mockup' | 'proof' | 'print_ready' | 'source' | 'photo' | 'other';
  version: number;           // increments when a newer file supersedes (same assetGroupId)
  assetGroupId: string;      // stable id grouping versions of the same artwork
  label?: string;
  productId?: string;        // attach to a product/variant…
  variantId?: string;
  quoteId?: string;          // …and/or a quote…
  poId?: string;             // …and/or a PO
  uploadedBy: string;
  createdAt: string;
}
```

- **Upload via the existing Blob route**; store the `Asset` record + reverse indexes
  (`assets:product:{id}`, `assets:quote:{id}`, `assets:po:{id}`).
- **Versioning**: uploading a newer file for an `assetGroupId` bumps `version`; UI shows latest
  with a "history" expander. Don't delete old versions (proofs are records).
- **Surface inline**: a thumbnail strip on the product editor, quote detail, and PO detail —
  the same asset can appear in all three because of the join ids. Image previews for image mimes;
  a labeled file chip for `print_ready` (e.g. PDF/AI/SVG) where no preview is possible.
- Mirror `Assets` to Airtable (url + metadata) via `safe()`.

**Acceptance:** Upload a sticker mockup, attach it to a quote; accept the quote → the asset is
visible on the resulting product and on the PO without re-uploading. Uploading v2 keeps v1 in
history.

---

## 6. Permissions, schema, and cross-cutting

- **New permission** `canManageSourcing` in `AdminPermissions` + `ROLE_PERMISSIONS`
  (`src/types/Admin.ts`): `true` for `manager`; decide `store_manager` (recommend `true` for
  sourcing/assets but cost basis still gated by `canManageFinance`); `false` for `reader`.
  Update `src/lib/adminAuth.ts` / `src/app/api/admin/me/route.ts` if they enumerate permissions.
- **`Product` additions**: `draft?: boolean` (if not present) and per-variant
  `reorderPoint?: number`. Drafts must be excluded by the storefront/product API filter — verify,
  don't assume.
- **Docs**: create `docs/SOURCING.md` — the entity model, the Redis key layout, the new Airtable
  tables/columns, the receiving→costing rule, and the setup-fee/shipping amortization
  approximation. Add an entry block to `SHOP_UPGRADE_PROMPT.md` §7 ("shipped") as each piece lands.
- **Tests**: if test infra exists by now, cover the highest-risk logic: PO-receive idempotency
  (no double-count), price-break selection / landed-cost math, and the quote→product seed. If no
  infra yet, at minimum write the receive path defensively around the existing claim-key guards.
- **Build/lint**: every PR ends with `npm run build` and lint passing, and a note of which
  acceptance criteria it meets and how to test it.

---

## 7. Explicitly OUT of scope this track (so the system stays focused)

- **Customer comms hub** (templated/broadcast email, restock notify-me, per-customer timeline) —
  a strong candidate for the *next* track, but not here. Keep `email.ts` usage limited to what
  already exists.
- **AI assistant / NL admin** (parse-a-pasted-quote, "what should I reorder?") — the command
  center in §4 surfaces the same signals deterministically first. AI is a layer to add **on top**
  once the structured data exists, not a prerequisite. Note it as a future track.
- Multi-currency beyond flag-and-note; tax/duty modeling; vendor payment/AP. Out.

---

## 8. How to work

1. **Plan first; ship in slices.** Recommended order, each a small PR:
   **(1)** Vendor + quote vault CRUD + Airtable mirror (§2) — pure additive, low risk, immediately
   useful. **(2)** Quote comparison view (§2) — the decision payoff. **(3)** Asset manager (§5) —
   additive, reuses Blob. **(4)** Quote→Product + PO + **receiving through `receiveStock`** (§3) —
   the careful one; this is where idempotency and the finance invariant matter most. **(5)** Command
   center (§4) — last, because it reads from everything the prior slices created.
2. **Reuse the backbone.** Receiving posts through `costing.ts`; mirrors go through the `safe()`
   pattern; uploads through the Blob route; mutations through `recordAudit`. When a PR touches the
   costing ledger or inventory, state explicitly how invariants §0.1–§0.5 are preserved.
3. **Internal-only by default.** Nothing in this track renders on a public/storefront route. Cost
   basis and vendor pricing are gated by role on both page and API.
4. **Don't regress the brand or the shipped tracks.** Phantom Sans, the palette, the playful
   polish stay. The four shipped tracks (inventory, catalog, finance, HCB/EasyPost) keep working.

---

## 9. Key files reference (new + touched)

| Concern | Files |
|---|---|
| New types | `src/types/Sourcing.ts` (Vendor, Quote, PurchaseOrder, Asset); `Product`/`ProductVariant` additions in `src/types/Admin.ts` |
| Sourcing logic | `src/lib/sourcing.ts` (Redis CRUD + indexes), mirror additions in `src/lib/airtableMirror.ts` |
| Receiving join | `src/lib/costing.ts` (`receiveStock` — reuse, don't fork) |
| Reorder/velocity | `src/lib/inventory.ts`, `src/lib/finance.ts` (read-only) |
| Sourcing API | `src/app/api/admin/sourcing/{vendors,quotes,pos}/...`, `src/app/api/admin/assets/...` |
| Overview API | `src/app/api/admin/overview/route.ts` |
| Sourcing pages | `src/app/admin/sourcing/` (vendors, quotes, compare, pos), asset UI on product/quote/PO editors |
| Command center | `src/app/admin/page.tsx` (live action feed + secondary nav) |
| Permissions | `src/types/Admin.ts`, `src/lib/adminAuth.ts`, `src/app/api/admin/me/route.ts` |
| Uploads | existing `src/app/api/admin/upload/` + `@vercel/blob` |
| Audit | `src/lib/auditLog.ts` (`recordAudit`) |
| Docs | `docs/SOURCING.md` (new); `SHOP_UPGRADE_PROMPT.md` §7 (shipped log) |
