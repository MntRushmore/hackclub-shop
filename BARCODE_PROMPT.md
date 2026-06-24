# Hack Club Shop — Barcode & Scan-to-Receive Spec ("Every unit has a label")

> The next track after the Admin OS (`ADMIN_OS_PROMPT.md`). That track made the admin a
> connected operations system; this one gives the **physical merch a physical identity** — a
> beautiful, on-brand barcode/QR label per variant — and turns receiving inventory into a
> point-and-scan motion instead of a typing exercise.
>
> Written against the actual codebase (Next.js 14 App Router · TypeScript · Tailwind · Upstash
> Redis source-of-truth · Airtable write-only mirror · Vercel Blob · NextAuth/Hack Club OAuth).
> **Read `docs/INVENTORY.md`, `docs/FINANCE.md`, `docs/SOURCING.md`, `src/lib/costing.ts`, and
> `src/lib/inventory.ts` before starting** — this spec extends them and must not regress them.
>
> **STATUS: complete.** All three slices shipped (Code 128 chosen over QR/DataMatrix). The
> living reference is now `docs/BARCODES.md`; this file is the original spec.

---

## 0. Context the implementer must hold

The shop already has a complete inventory + costing backbone. **This track is a UI/identity
layer on top of it. It introduces no new stock-mutation path.**

**What already exists (reuse, do not reinvent):**

| Capability | Where | Reuse it for |
|---|---|---|
| `receiveStock()` — the ONLY way stock + weighted-avg cost change, idempotent via `receipts:claim:{id}` | `src/lib/costing.ts` | Every scan-to-receive posts **through `receiveStock`**. No second costing path. |
| Inventory units + reservations + `setStock` | `src/lib/inventory.ts` | Show on-hand/available next to a scanned variant. Quick stock-count corrections still go through `setStock` (the existing PATCH). |
| Product + dual-priced variant model | `src/types/Admin.ts` (`Product`, `ProductVariant`) | The barcode encodes the variant. `variant.variant_id || variant.id` is the canonical key (matches `inventory.ts`/`costing.ts`). |
| Existing inventory UI | `src/app/admin/inventory/page.tsx` (route `/admin/inventory`, gate `canManageProducts`) | Add a "Print labels" affordance per variant; link to the new scan-receive screen. |
| Existing receiving UI + API | `src/app/admin/finance/receiving` + `src/app/api/admin/finance/receiving/route.ts` (gate `canManageFinance`) | The scan screen is a faster front-end to this same `receiveStock` call. |
| Sourcing PO receive | `src/lib/sourcing.ts` `receivePO()`, deterministic receipt id `{poId}__{variantId}` | Scan-receive against an **open PO** should reconcile to its lines (see §4). |
| Airtable write-only mirror (fire-and-forget, self-healing) | `src/lib/airtableMirror.ts` (`safe()`/`upsert()`) | If we persist a per-variant SKU/barcode value, mirror it the same way. |
| Audit log | `src/lib/auditLog.ts` (`recordAudit`) | Every scan that moves stock audits (already true inside `receiveStock`); label (re)generation audits too. |
| Permission gates | `src/types/Admin.ts` (`AdminPermissions`, `ROLE_PERMISSIONS`) | Gate scan-receive on `canManageFinance` (it moves cost basis) on BOTH page and API. Label printing on `canManageProducts`. |
| Hack Club brand styling | Tailwind `hackclub-*` palette, Phantom Sans, grid-paper background, rounded-2xl cards, black headings | Labels and all new screens must look unmistakably Hack Club. |

**Non-negotiable invariants (do not regress):**
1. **Scan-to-receive posts through `receiveStock()`.** Never bump `variant.stock` or write
   `variant.unitCost` directly from a scan handler. The weighted-average blend + idempotency are
   the whole point.
2. **Idempotency.** A barcode is a physical object that gets scanned twice. Every receive carries
   a deterministic `receiptId` (see §4) so a double-scan/double-tap moves stock exactly once.
3. **Airtable / Blob failures never throw into a write path** — fire-and-forget, swallowed.
4. **Permission gates on BOTH page and API route** for every new action.
5. **No cost basis / vendor pricing leaks** to non-finance roles or any public route. Barcodes
   themselves are non-secret (they're on physical product), but the receive screen shows cost.
6. **The barcode payload is opaque and stable.** It must not embed price, cost, or PII — only an
   identifier that resolves server-side to a variant.

---

## 1. Goal (what "every unit has a label" means)

A staffer can: **open a variant → print a sheet of crisp, Hack-Club-branded labels (barcode or
QR + human-readable SKU + product/variant name) → later, at the receiving table, open the scan
screen and scan a label with the HQ USB barcode scanner (or a phone camera) → the variant resolves
instantly, its current on-hand shows, they type/confirm a quantity and unit cost (pre-filled from
the linked PO or last receipt) → tap once → stock and cost basis update through `receiveStock` →
the next scan is ready.** No hunting for a variant in a dropdown. No typo'd IDs.

**There is a real USB barcode scanner at HQ — design for it as the primary input.** A USB scanner
is a HID keyboard: it types the decoded payload and sends a terminating keystroke (usually Enter)
in a fast burst. The scan screen's input must therefore be a hardware-scanner-first experience:
- An **always-focused, auto-refocusing** capture field (refocus on resolve, on confirm, on window
  focus) so a staffer never has to click before scanning.
- A **keystroke-burst detector**, not just "submit on Enter": a scanner types many chars in a few
  ms then Enter; a human types slowly. Buffer keystrokes and treat a fast burst-then-Enter as a
  scan, so an accidental human keypress in the field doesn't fire a lookup. (Configure the scanner
  to suffix Enter; the detector is the resilient fallback.)
- **Audible/visual feedback per scan** (a tick sound + a green flash on success, a buzz + red on
  unknown SKU) — at a receiving table you're looking at the box, not the screen.
- The phone-camera (ZXing) path is the **secondary** input for when you're away from the HQ
  station; both feed the exact same resolve→receive code path.

Three connected slices, each independently shippable. Prefer small verifiable PRs.

---

## 2. The identifier: a stable, human-readable SKU + an opaque scan payload

**Decision to make first (and the recommended answer):**

- **Add an explicit, human-readable `sku` to `ProductVariant`** (`src/types/Admin.ts`). Today
  identity is the opaque `variant_id` (`var_169..._0`) — fine for machines, useless on a printed
  label a human reads aloud. A SKU like `HC-STICKER-3IN-RED` is scannable AND legible.
  - Format: `HC-{CATEGORY}-{SHORT}-{VARIANT}`, uppercased, hyphen-delimited, derived from
    product category + name + variant size/color, deduped with a numeric suffix on collision.
  - **Auto-generate on demand** (a "Generate SKU" action / backfill script), editable by an admin,
    unique across all variants (maintain a `sku:{sku} → variantId` reverse index in Redis to
    enforce + to resolve a scanned SKU back to a variant in O(1)).
  - Mirror to Airtable (`Variants JSON` already carries the full variant; optionally add a top-level
    `SKU List` convenience column — follow the `Total Stock` precedent).
- **The barcode/QR encodes the SKU** (not the opaque `variant_id`, not a URL with secrets). The
  SKU is the single value a human reads, a scanner emits, and the resolver looks up. One identity,
  three representations (printed text, barcode, QR).
  - **Recommend QR (or DataMatrix) as the primary symbology**, with an optional 1D Code128 row for
    cheap laser scanners. QR survives a phone camera, small label sizes, and partial damage far
    better than a 1D barcode — and a phone is the realistic scanner here. Make symbology a small
    config constant so we can switch.

**Why SKU-as-payload beats `variant_id`-as-payload:** the label stays meaningful if printed and
read by a person, the same string works in the search box, and we never expose the internal id
scheme on physical goods. The reverse index makes resolution exact and fast.

**Libraries (check `package.json` first; add only if absent, pin versions, match existing deps):**
- QR generation: `qrcode` (renders to canvas/SVG/dataURL — SVG preferred for crisp print).
- 1D barcode (if we include Code128): `jsbarcode` or `bwip-js` (bwip-js does both QR + 1D + DataMatrix; consider it as the single dependency).
- Scanning in-browser: `@zxing/browser` (`@zxing/library`) or `html5-qrcode` — both wrap
  `getUserMedia` + WASM decode and read QR **and** 1D. Prefer ZXing for breadth/maintenance.
- A USB barcode scanner is just a keyboard (HID) that types the payload + Enter — the scan input
  must also work as a plain focused text field, no camera required. **Support both with one input.**

---

## 3. Slice A — Label designer, printing & the playground (the "good looking" part)

The headline ask: barcodes that look like they belong to Hack Club, not a warehouse — **plus a
dedicated designer/playground page** where you tweak a label, scan-test it live with the HQ scanner
or a phone, and print sheets.

**The designer / playground** (`/admin/labels`, gate `canManageProducts`) — the front of this slice:
- **Live design controls:** symbology (QR / DataMatrix / Code128), label size/template (30-up Avery
  5160, larger product tag, custom mm/in), what to show (logo on/off, product name, variant,
  human-readable SKU), accent color for the brand rule. Every control re-renders the preview
  instantly.
- **Fun test payload:** type any string (or pick a real variant) and watch the symbol regenerate —
  great for "does this scan?" experiments without touching real inventory.
- **Scan-test it live:** a built-in decoder (same ZXing path as the receive screen, plus the
  always-focused HID field) so you point the HQ scanner / phone at the screen-rendered code and
  confirm it decodes back to exactly what you encoded. Round-trip proof, right on the design page.
- **Print sheets:** lay the chosen template out N-up and print via the browser dialog. Pick real
  variants (search / "all low-stock" / "all lines on a PO") or print a test sheet of the playground
  payload. Quantity-per-variant so you print exactly what you received.

This page is both the brand tool and the QA tool. Build it first; the per-row "Print label" buttons
on `/admin/inventory` and the product editor just deep-link into it with a variant preselected.

**A printable label component** (`src/app/admin/labels/` + a `<Label>` component):
- One label = QR (and optional Code128 row) + the human-readable SKU + product name + variant
  (size/color) + a small Hack Club flag/logo mark. On-brand: Phantom Sans, `hackclub-*` palette,
  rounded corners, the playful-but-clean look of the rest of admin. Black text on white for scan
  reliability; brand color only in the logo/accent rule (a high-contrast quiet zone around the
  symbol is mandatory — do not tint the code itself).
- **Print-accurate sizing.** Lay labels out on a standard sheet (e.g. Avery 5160 / 30-up, and a
  larger product-tag size) using a print stylesheet (`@media print`, exact mm/in dimensions,
  `@page` margins). "Print" = the browser print dialog → any label printer or laser sheet. No
  native printing dependency.
- **Render the symbol as SVG** for vector-crisp output at any DPI. Embed the logo inline (no
  external fetch — print runs offline).
- **Batch print:** select N variants (or "all low-stock", or "all lines on this PO") → a print
  sheet with the right quantity of each. Quantity-per-variant input so you can print exactly the
  count you received.
- Route `/admin/labels` (gate `canManageProducts`), plus a "Print label(s)" button on each
  `/admin/inventory` row and on the product editor variant rows.

**Deliverable:** a staffer can produce a clean sheet of labels for any set of variants in under a
minute, and the labels look like Hack Club made them on purpose.

> Use the `artifact-design` skill when designing the label + scan UI to keep the bar high. The
> label is a brand object — treat it like one.

## 4. Slice B — Scan-to-receive (the speed win)

**A scan screen** `src/app/admin/receiving/scan` (gate `canManageFinance`):
- A single always-focused, auto-refocusing input (see §1: hardware-scanner-first) that accepts
  **either** the HQ USB scanner / keyboard wedge (types SKU + Enter, primary) **or** a camera
  decode (ZXing live view, toggle on, secondary). One code path: on a complete payload, resolve it.
  Per-scan audible + color feedback so the operator can keep their eyes on the box.
- **Resolve** via `GET /api/admin/receiving/resolve?sku=…` → `{ productId, variantId, productName,
  variantName, sku, onHand, available, unitCost (finance only), lastReceiptUnitCost, openPO? }`.
  Backed by the `sku:{sku} → variantId` reverse index; 404 + a clear "unknown label — generate a
  SKU for this variant first" message on miss.
- On resolve, show a card: product/variant, current on-hand + available, a **quantity** field
  (default 1, or "+1 per scan" rapid mode for counting), and a **unit cost** field pre-filled from
  the open PO line or the last receipt (editable; finance-gated visibility). Confirm → `POST
  /api/admin/receiving/scan` → calls `receiveStock(...)`.
- **Idempotency / receipt id:**
  - Free receiving (no PO): `receiptId = scan_{variantId}_{sessionScanSeq}` or let the route
    generate one — but the SAME submit retried (network retry, double-tap) must reuse the id.
    Generate it client-side per confirmed line and send it, so a retry is a no-op (matches the
    existing claim-key contract).
  - **PO reconciliation (the connected win):** if `resolve` finds an `openPO` line for this
    variant, receiving against it uses the **existing deterministic id `{poId}__{variantId}`** and,
    when the PO's lines are all received, advance the PO via the existing `receivePO`/PO-status
    path. Do **not** invent a parallel receive — reuse `src/lib/sourcing.ts`. This makes "scan the
    box as it arrives" automatically close out the purchase order.
- **Session feed:** a running list of "received this session" (variant, qty, new on-hand) with
  undo-awareness messaging (you can't un-receive through this screen — that's a finance
  restock/adjustment — but show the receipt id so it's traceable). Reuse `readVariantReceipts`.

**Deliverable:** receiving a 200-unit sticker shipment is: open scan screen, scan box label, type
200, confirm. Stock + weighted-avg cost are correct, the PO closes, the receipt is in the ledger.

## 5. Slice C — Reverse uses (scan to look up / count)

Once a label resolves to a variant, two cheap, high-value modes fall out:
- **Lookup mode:** scan → jump straight to that variant's inventory row / product editor (no
  receive). Useful at a table: "what is this and how many do we have?"
- **Cycle-count mode:** scan a bin of items, enter the counted quantity, and **set** stock (through
  the existing `setStock` PATCH on `/api/admin/inventory`, NOT `receiveStock` — a count correction
  is not a purchase and must not touch cost basis). Audit it as `inventory.count`/`inventory.adjust`.
  Make the receive-vs-count distinction explicit in the UI so cost basis is never moved by accident.

---

## 6. Data & API summary (match existing conventions exactly)

**Type change** (`src/types/Admin.ts`):
```ts
// ProductVariant
sku?: string;   // human-readable, unique, encoded on the printed barcode/QR. Optional =
                // not yet labeled. Resolution uses the sku:{sku} reverse index.
```

**Redis keys (follow the established record + reverse-index shape):**
```
sku:{sku}            → variantId            (reverse index for O(1) scan resolution; enforces uniqueness)
```
(Receiving reuses `receipts:*` from costing.ts. Stock reuses `inventory:*`. No new ledger.)

**API routes (App Router, `requireAdminPermission` on each):**
```
POST /api/admin/labels/sku            → generate/assign a SKU for a variant (canManageProducts), maintains reverse index, audits
GET  /api/admin/receiving/resolve     → resolve a scanned SKU → variant + stock + cost + openPO (canManageFinance)
POST /api/admin/receiving/scan        → receiveStock() for a resolved variant; reconciles to PO if present (canManageFinance)
POST /api/admin/receiving/count       → setStock() cycle-count correction (canManageProducts; explicitly NOT a receive)
```

**Audit actions:** `inventory.sku.assign`, `inventory.receive` (already emitted by receiveStock),
`inventory.count`.

**Airtable:** add SKU to the existing product mirror (it rides inside `Variants JSON`; optionally a
`SKU List` convenience column following the `Total Stock` precedent). No new tables.

---

## 7. Out of scope (this track)
- Customer-facing QR (e.g. scan-to-shop, authenticity, order tracking) — separate track.
- Native/thermal-printer SDKs — we print via the browser dialog only.
- Multi-warehouse / bin-location tracking — single-location assumed, as today.
- Barcode-driven order *fulfillment* (pick/pack/ship scanning) — possible later slice; this track
  is receiving + identity only.

---

## 8. Build order & verification

1. **Slice A first** (labels) — it's standalone, demoable, and the brand artifact you asked for.
   Verify: SKUs generate uniquely; a print sheet renders crisp SVG codes that a phone decodes.
2. **Slice B** (scan-to-receive) — the operational payoff. Verify: scan→resolve→receive moves stock
   through `receiveStock` once even on double-tap; PO reconciliation closes an open PO; cost is
   blended correctly (check `/admin/finance` valuation before/after).
3. **Slice C** (lookup + count) — small additions on the resolver. Verify: count uses `setStock`,
   NOT `receiveStock` (cost basis unchanged after a count).

**Acceptance demo:** Generate labels for a sticker variant → print → scan with a phone on the scan
screen → receive 200 against an open PO → PO flips to received, on-hand jumps by 200, weighted-avg
cost is right, receipt is in the ledger with the deterministic id. Then scan the same label in
count mode and correct the count without touching cost.

**Docs:** create `docs/BARCODES.md` (identifier scheme, symbology choice, key layout, the
receive-vs-count distinction) and add a "Labels" / "Scan to receive" card to `/admin`.
