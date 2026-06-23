# Self-prompt: Finance-grade Inventory & Costing system

> A self-contained build prompt. Hand this back to yourself (or a fresh agent) to
> execute the work end to end. Grounded in the actual `store-v2` codebase —
> read the "Ground truth" section before writing any code.

## The ask (in the user's words)

> "We need to make a very very good Inventory system, like what's on hand, how
> much we paid for it, weekly reports, graphs, and basically everything for our
> finance team to not be mad."

## What already exists (do NOT rebuild)

The shop **already has an operational inventory layer** (shipped 2026-06-22, see
`docs/INVENTORY.md` + `src/lib/inventory.ts`). It answers *"how many units can we
sell right now"*: per-variant `stock`, `reserved` overlay, `available = max(0,
stock − reserved)`, reserve→commit/release across Stripe + points pathways,
oversell protection, Airtable-authoritative base with Redis cache, `/admin/inventory`
quick-adjust page.

It has **zero financial dimension.** That is the gap this build fills.

## What we're building: the *finance* layer

A **costing & valuation** layer that sits on top of the existing unit layer and
answers the questions a finance team actually asks:

1. **What's on hand, and what is it worth?** — units × unit cost = inventory
   valuation, per variant / product / category and in total.
2. **How much did we pay for it?** — a cost basis per variant, captured when stock
   is received (purchases / receiving records), with weighted-average cost.
3. **What did we make?** — per-order and per-period **COGS** and **gross margin**
   (revenue − COGS), for the cash (Stripe) pathway. Points orders contribute COGS
   (real money left the building) but $0 cash revenue — surface both so margin
   math is honest.
4. **Weekly reports** — a scheduled/queryable weekly rollup: units sold, revenue,
   COGS, gross margin, units received, spend, ending on-hand valuation, low-stock
   and dead-stock flags. Exportable to CSV (finance lives in spreadsheets).
5. **Graphs** — inline-SVG (no chart lib; match `RevenueChart` in
   `src/app/admin/stats/page.tsx`): valuation over time, weekly margin, spend vs
   revenue, top products by margin.

## Ground truth (read these before coding)

| Thing | Location | Notes |
|---|---|---|
| Unit inventory model | `docs/INVENTORY.md`, `src/lib/inventory.ts` | reserve/commit/release; `available = stock − reserved`; untracked = unlimited |
| Admin Product type | `src/types/Admin.ts` → `Product` / `ProductVariant` | variants have `price_cash?`, `price_points?`, `stock?`, `weightOz?`. **Add `unitCost?` here.** |
| Order type | `src/types/Order.ts` → `Order` / `OrderItem` | `pathway` (`student`/`guest`), `paymentMethod`, `totalAmount` (USD), `pointsSpent`, `isTest`, `items[]`. `OrderItem` has `id`,`name`,`price`,`quantity` — **no variantId or cost today.** |
| Redis layout | — | products: `product:*`; student orders: `user:*:orders` (array); guest orders: `order:*` (single). Inventory: `inventory:{variantId}`, `inventory:{variantId}:reserved` |
| Admin auth | `src/lib/adminAuth.ts`, `src/types/Admin.ts` | `requireAdminPermission(session, perm)`. Perms: `canManageProducts`, `canViewStats`, `canManageUsers`, `canManageBalance`, `canManageCoupons`, `canManageAdmins`. Roles: manager / store_manager / reader |
| Audit log | `src/lib/auditLog.ts` → `recordAudit(...)` | capped Redis list; wire every financial mutation through it |
| Airtable mirror | `src/lib/airtableMirror.ts` → `mirrorProduct(p)` | fire-and-forget, never throws |
| Existing stats API | `src/app/api/admin/stats/route.ts` | how to enumerate all orders across both key patterns; reuse the iteration shape |
| Chart pattern | `src/app/admin/stats/page.tsx` → `RevenueChart` | inline SVG/divs, `title` tooltips, CSP-safe, no deps |
| Inventory admin page | `src/app/admin/inventory/page.tsx` | Hack Club design system (`hackclub-*` tailwind tokens, framer-motion, rounded-full buttons) to match |

## Hard invariants (from `[[shop-upgrade-roadmap]]` — never regress)

- **Fire-and-forget safe:** every new finance read/write degrades gracefully on a
  Redis/Airtable hiccup. A costing failure must **never** block a sale or break a
  checkout/webhook path. Mirror the `inventory.ts` / `email.ts` safe-no-op style.
- **Admin gates on BOTH page and API.** Reuse `requireAdminPermission`. Finance
  reads → `canViewStats`; cost edits / receiving → `canManageProducts` (or a new
  `canManageFinance` perm — see decisions).
- **Exclude `isTest` orders** from all financial aggregates (match stats route).
- **No new dependencies.** Inline-SVG charts only. CSV export must be
  **formula-injection-safe** (match the existing `/admin/orders` CSV escaping —
  prefix `=+-@` cells with `'`).
- **Don't touch the hot checkout/webhook path's behavior.** Capturing per-line
  cost onto orders is additive and must be wrapped so a missing cost = `0` COGS,
  never a throw.

## Architecture

### 1. Cost basis on variants
- Add `unitCost?: number` (USD) to `ProductVariant` in `src/types/Admin.ts` and to
  the admin product form. This is the *current* standard cost — what we pay per
  unit. Optional; missing = unknown cost (treated as `0` in COGS but flagged
  "uncosted" in reports so finance can see coverage).

### 2. Receiving / purchases ledger (how much we paid)
New lib `src/lib/costing.ts` + Redis-backed ledger:
- `receipt:{id}` records: `{ id, variantId, productName, variantName, quantity,
  unitCost, totalCost, receivedAt, note, actorId }`. Append-only.
- Index: `receipts:index` (capped list of ids, like the audit log) +
  `receipts:variant:{variantId}` for per-variant history.
- On receiving stock: (a) write the receipt, (b) recompute **weighted-average
  unit cost** for that variant and store it back on the variant (`unitCost`), (c)
  bump unit stock via the existing `setStock` / product update path so the two
  layers stay consistent, (d) `recordAudit`, (e) `mirrorProduct`.
- This makes "how much we paid for it" a real, auditable number, not a guess.

### 3. COGS capture on sale
- Extend `OrderItem` with optional `variantId?` and `unitCost?` so each sold line
  carries the cost basis **at time of sale** (point-in-time, so later cost changes
  don't rewrite history). Populate in both checkout routes from the variant's
  current `unitCost`, wrapped defensively (missing → omit/0).
- Reports compute order COGS = `Σ(line.quantity × (line.unitCost ?? variant
  fallback ?? 0))`. Provide a fallback that looks up the *current* variant cost for
  legacy orders that predate the field, clearly labelled "estimated".

### 4. Finance lib (`src/lib/finance.ts`)
Pure aggregation over orders + products + receipts. Functions:
- `getInventoryValuation()` → per-variant/product/category on-hand units × unitCost,
  plus totals + uncosted-coverage %.
- `getCogsAndMargin(period)` → revenue, COGS, gross margin, margin %, split by
  cash vs points pathway; per-product breakdown; top/bottom by margin.
- `getSpend(period)` → receiving spend from the ledger.
- `getWeeklyReport(weekStart?)` → one ISO-week rollup combining the above + units
  sold/received + dead-stock (no sales in N weeks) + low-stock. This is the
  finance team's headline artifact.
- `getValuationTimeSeries()` / weekly series for the charts.
All read-only, fire-and-forget safe, exclude `isTest`.

### 5. API routes (under `src/app/api/admin/finance/`)
- `GET /api/admin/finance/overview?period=` → valuation + COGS/margin + spend
  (powers the dashboard). `canViewStats`.
- `GET /api/admin/finance/weekly?week=` → weekly report JSON. `canViewStats`.
- `GET /api/admin/finance/weekly/export?week=` → CSV (injection-safe). `canViewStats`.
- `POST /api/admin/finance/receiving` → record a stock receipt (qty + unitCost),
  updates avg cost + stock + audit + mirror. `canManageProducts`.
- `GET /api/admin/finance/receiving?variantId=` → receipt history. `canViewStats`.

### 6. Admin UI
- New `src/app/admin/finance/page.tsx` — the finance dashboard:
  - **KPI cards:** on-hand valuation, period revenue, period COGS, gross margin
    ($ and %), receiving spend, uncosted-variant count.
  - **Charts (inline SVG):** weekly gross margin (bars), valuation trend (line/bars),
    spend vs revenue, top-10 products by margin.
  - **Weekly report panel:** week picker + table + "Export CSV" + "Email/print"
    affordance; dead-stock and low-stock callouts.
  - **Receiving form:** pick variant → qty + unit cost → "Receive stock" (writes
    ledger + bumps stock). Recent receipts table below.
  - Period selector (week/month/year/all) mirroring the stats page.
  - Match the Hack Club design system exactly (tokens, motion, layout) — model on
    `src/app/admin/inventory/page.tsx` and `src/app/admin/stats/page.tsx`.
- Add a **Finance / Inventory Value** card + link to the admin dashboard
  (`src/app/admin/page.tsx`) and cross-link from `/admin/inventory`.

### 7. Weekly report delivery (graphs + report for finance)
- Primary: the dashboard's week picker + CSV export (always works, no infra).
- Optional stretch (gate behind config, safe-no-op if unset, like `email.ts`):
  a `POST /api/admin/finance/weekly/send` that emails the finance distro the
  week's summary via the existing `src/lib/email.ts`. Only build if email lib
  supports it cleanly; otherwise document the `/schedule` path and skip.

### 8. Docs
- `docs/FINANCE.md`: the costing model (weighted-avg cost, point-in-time COGS,
  points-vs-cash margin treatment, valuation formula), Redis keys, where numbers
  come from, and the known approximations (legacy orders w/o line cost, Redis-leads-
  Airtable between counts). Finance must be able to trust and audit the numbers.

## Correctness notes / gotchas

- **`OrderItem` has no `variantId` today.** Confirm in both checkout routes whether
  the variant id is available at line-build time (it should be — pricing is dual
  per variant). If a line truly can't be mapped to a variant, COGS for it falls to
  the fallback and the report flags partial coverage. Don't fabricate a mapping.
- **Points orders:** revenue (USD) = 0 but COGS > 0. Report **cash gross margin**
  separately from **points-fulfillment cost** so a heavy points week doesn't read
  as a catastrophic negative margin. Be explicit in the UI labels.
- **Weighted-average cost** recompute must be monotonic and safe: `newAvg =
  (oldUnits×oldAvg + recvUnits×recvCost) / (oldUnits + recvUnits)`, guarding
  div-by-zero and missing oldAvg. Document the choice (avg, not FIFO) in `FINANCE.md`.
- **Reserved units in valuation:** value **on-hand = `stock`** (what we physically
  have), not `available` — reserved units are still ours until the sale commits.
  State this explicitly.
- **CSV injection:** reuse the exact escaping from the `/admin/orders` CSV export.
- **Idempotency of receiving:** a double-submit shouldn't double-count. Use a
  client-supplied or generated receipt id and a Redis `SET NX` guard, mirroring
  `claimOrderSettlement`.

## Definition of done

- [ ] `unitCost` on variant type + admin product form; reads/writes round-trip.
- [ ] Receiving ledger writes receipts, recomputes weighted-avg cost, bumps stock,
      audits, mirrors — all fire-and-forget safe.
- [ ] COGS captured point-in-time on new orders (both pathways), defensively wrapped.
- [ ] `finance.ts` aggregations correct, test-order-excluded, fail-soft.
- [ ] All 5 API routes gated on both page + API, correct permission each.
- [ ] `/admin/finance` dashboard: KPI cards + ≥3 inline-SVG charts + weekly report
      table + CSV export + receiving form, on-brand.
- [ ] Linked from admin dashboard + inventory page.
- [ ] `docs/FINANCE.md` explains the model and its approximations.
- [ ] `npm run build` / lint clean. No new deps. No checkout/webhook regression.
- [ ] Report back: what shipped, the numbers' provenance, known approximations,
      and any follow-ups (matches the "build autonomously, report at the end" style).

## Decisions (RESOLVED 2026-06-23)

1. **Access:** add a new **`canManageFinance`** permission. Managers get it by
   default; store_manager/reader do not. Gate finance reads + receiving on it
   (not on `canViewStats`/`canManageProducts`).
2. **Costing:** **weighted-average cost** (not FIFO).
3. **Weekly delivery:** **dashboard + CSV export only.** No email endpoint.
   (Skip §7's optional email stretch entirely.)
4. **Scope:** **full build now, autonomous, report at the end.**
