# Barcodes & Labels — SKU identity + label designer

Every merch variant can carry a **SKU** — a human-readable, store-wide-unique id
(e.g. `HC-STICKER-3IN-RED`) that is printed on a Hack Club Shop–styled label and
encoded as a **Code 128** barcode. The SKU is the single value a person reads aloud, a
scanner emits, and the system resolves back to a variant. One identity, three
representations: printed text, barcode, search box.

All three slices of `BARCODE_PROMPT.md` are shipped: **A** (label designer + printing +
scan-test), **B** (scan-to-receive with PO reconciliation), and **C** (scan to look up /
cycle-count). They share one SKU identity and one scan-input contract (`useScanInput`).

## Why Code 128

Code 128 is the ubiquitous 1D symbology every handheld USB laser scanner reads
instantly — including the scanner at HQ — and it's compact for short alphanumeric SKUs.
We render it to **SVG** (via `bwip-js`) so labels stay vector-crisp at any print DPI.
Bars are always pure black on white with the mandatory quiet zone preserved; the brand
accent only ever touches the surrounding label chrome, never the code.

## The SKU (`src/lib/sku.ts`)

- **Field:** `ProductVariant.sku?: string` (`src/types/Admin.ts`). Optional = not yet
  labeled. Non-secret (it lives on physical product) — never embed price/cost/PII.
- **Format:** `HC-{CATEGORY}-{PRODUCT}-{VARIANT}`, uppercased, hyphen-delimited, built
  from the product category/name + variant size/color (`buildSkuCandidate`). Best-effort
  squeezing keeps segments short.
- **Uniqueness + resolution:** a Redis reverse index `sku:{sku} → variantId` enforces
  store-wide uniqueness and resolves a scanned/typed SKU to a variant in O(1)
  (`resolveSku`). `normalizeSku` canonicalizes case/whitespace so a sloppy scan still
  resolves.
- **Assignment is single-source:** `assignSku(product, variantId, desired?)` is the ONLY
  writer of the index. It normalizes, resolves collisions with a numeric suffix
  (`-2`, `-3`, …), writes the SKU onto the variant, claims the new index key, and
  releases the old one. Auto-generates when `desired` is omitted.

> **Invariant:** the `sku:{sku}` index is authoritative and is maintained ONLY by
> `assignSku`. The product save APIs deliberately do **not** persist a submitted `sku`
> (POST drops it; PUT preserves the *existing* value from Redis) — a plain product edit
> must never rewrite a SKU, or the index would desync. Changing a SKU is a deliberate
> action through the labels API.

## API

```
GET  /api/admin/labels   → every variant with { sku, suggestedSku, stock } (canManageProducts)
POST /api/admin/labels   → assignSku() for one variant; { productId, variantId, sku? }
                           (auto-generates when sku omitted); maintains index; audits
```

Audit action: `inventory.sku.assign`.

## The designer / playground (`/admin/labels`)

Gate: `canManageProducts`. One page that is both the brand tool and the QA tool:

- **Live design controls** — label size/template, what to show (logo / product / variant
  / SKU text), the brand mark (compact **bag** or **full wordmark**), and the accent.
- **Playground** — type any test payload and watch the barcode regenerate; no real
  inventory touched.
- **Scan-test (round-trip)** — `ScanTester.tsx`: an always-focused, auto-refocusing input
  captures the HQ USB scanner (keyboard wedge, terminated by Enter; a keystroke-burst
  detector ignores stray human keypresses), and an optional camera path (ZXing,
  dynamically imported only when toggled on). It compares the decode to the encoded value
  and shows ✓/✗. This is the same input contract the receive screen (Slice B) will use.
- **Variant picker + print** — search / "select all low-stock"; per-variant print
  quantity; "Generate SKU" inline for unlabeled variants. The print bar lays out the
  selected labels N-up on the chosen template and prints via the browser dialog
  (`@media print` + `@page`, exact mm sizing). Variants without a SKU are skipped and
  the count is surfaced.

The brand mark is the real Hack Club Shop logo, inlined as a data URI
(`src/app/admin/labels/wordmark.ts`) so printing works offline and every label on a
sheet reuses the same bytes. Two forms: the square shopping-**bag** mark (default,
compact) and the full **wordmark**.

## Scan to receive / look up / count (`/admin/receiving`)

One screen, three modes, gated on `canManageFinance` (receive moves cost basis). The
HQ USB scanner is the primary input via the shared `useScanInput` hook (always-focused
field + keystroke-burst detector; phone camera is the lazy-loaded secondary path). Every
scan plays a tick/buzz and flashes green/red so the operator can keep eyes on the box.

A scan hits `GET /api/admin/receiving/resolve?sku=…`, which returns the variant, current
on-hand/available, a unit-cost prefill (open PO line → last receipt → current avg), and
the matching **open PO** if any.

- **Receive** — `POST /api/admin/receiving/scan`. Posts through **`receiveStock`** (the
  only costing path). If the resolve found an open PO line, it routes through
  `receivePOLine` in `src/lib/sourcing.ts`, which uses the **same deterministic receipt
  id `{poId}__{variantId}`** as `receivePO` — so a scan and a manual "Receive PO" click
  can never double-count — and flips the PO to `received` once every line is in. Free
  receives (no PO) carry a client-supplied `receiptId` so a double-tap is idempotent.
- **Look up** — resolve only; jump to Labels / Inventory for that variant.
- **Cycle count** — `POST /api/admin/receiving/count`. **SETS** stock via `setStock`,
  NOT `receiveStock`: a stocktake is not a purchase and must never move cost basis. Gated
  on `canManageProducts` and audited as `inventory.count`. The UI makes the
  receive-vs-count distinction explicit so valuation is never moved by accident.

> **Invariant:** receiving posts through `receiveStock`; counting posts through
> `setStock`. They are different actions with different permissions and different audit
> events, and the screen never lets one masquerade as the other.

Audit actions: `inventory.receive` (from receiveStock), `inventory.count`.

## How it's connected to the rest of the admin

The point of the admin OS is that everything is connected; SKUs are no exception.

- **Inventory** (`/admin/inventory`) shows the SKU per row and a "Print label" /
  "Make label" deep-link to the designer with the variant preselected.
- **Product editor** (`/admin/products`) shows each variant's SKU and links to the
  designer to generate/print (kept out-of-band so the index stays authoritative).
- **Sourcing → catalog** (`/api/admin/sourcing/quotes/[id]/accept`): accepting a quote
  auto-mints a SKU for the seeded draft variant, so a sourced product is barcode-ready
  the instant it exists.
- **Purchase orders** (`/admin/sourcing/pos`) show the variant SKU on each PO line.
- **Command center** (`/admin`) surfaces an **Unlabeled stock** card — published variants
  with no SKU yet (gated on `canManageProducts`).

## Redis keys

```
sku:{sku}   → variantId    (reverse index; uniqueness + O(1) scan resolution)
```

(SKU values themselves live on the product variant inside `product:{id}`, and ride into
Airtable inside the existing `Variants JSON` via the product mirror — no new table.)

## Regenerating the inlined logo

`src/app/admin/labels/wordmark.ts` is generated from
`public/images/hack-club-shop-wordmark.png`: crop the left bag mark, downscale, and
base64-encode both the bag and the full wordmark into data URIs. Re-run the crop+encode
step (Pillow) if the source logo changes.

## Files

| Concern | Files |
|---|---|
| SKU type | `src/types/Admin.ts` (`ProductVariant.sku`) |
| SKU lib (generate, normalize, index, resolve) | `src/lib/sku.ts` |
| Code 128 renderer (bwip-js → SVG) | `src/lib/barcode.ts` |
| Labels API | `src/app/api/admin/labels/route.ts` |
| Designer page | `src/app/admin/labels/page.tsx` |
| Label component + sheet templates | `src/app/admin/labels/Label.tsx` |
| Scan-test (HID + camera) | `src/app/admin/labels/ScanTester.tsx` |
| Inlined brand marks | `src/app/admin/labels/wordmark.ts` |
| Shared scan-input hook (HID + camera) | `src/app/admin/receiving/useScanInput.ts` |
| Scan screen (receive / lookup / count) | `src/app/admin/receiving/page.tsx` |
| Receiving APIs | `src/app/api/admin/receiving/{resolve,scan,count}/route.ts` |
| Single-line PO receive | `src/lib/sourcing.ts` (`receivePOLine`) |
| Connections | `inventory`, `products`, `sourcing/quotes/.../accept`, `sourcing/pos`, `overview` + `CommandCenter` |
```
