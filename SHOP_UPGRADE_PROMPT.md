# Hack Club Shop — Upgrade & Improvement Spec

> A grounded, end-to-end improvement prompt for the Hack Club Shop. Written against the
> actual codebase (Next.js 13 App Router · TypeScript · Tailwind · Upstash Redis · Stripe ·
> NextAuth/Hack Club OAuth · Airtable mirror · Vercel Blob). Scope spans **admin**,
> **catalog**, **inventory (Airtable-backed)**, and **customer experience** for both the
> **adult/guest (Stripe)** and **hack-clubber/student (points)** pathways.

---

## 0. Context the implementer must hold

The shop forks into two pathways purely off auth state (`src/lib/usePathway.ts`):

- **`student`** — logged in via Hack Club OAuth, pays in **points**, orders go through
  `POST /api/orders` (immediate points deduction, order created `pending`→`approved`).
- **`guest`** — logged out, pays **real USD** via **Stripe Checkout**, order created
  `unpaid` and only confirmed by the `checkout.session.completed` webhook (the success
  redirect is never trusted as proof of payment).

Data lives in **Upstash Redis** as the source of truth. **Airtable is a fire-and-forget,
write-only mirror** (`src/lib/airtableMirror.ts`) for staff visibility — the app does *not*
currently read catalog/inventory back from it (only Projects reads from Airtable).

Dual pricing per variant (`src/types/Admin.ts`): a variant is buyable on a pathway **iff**
its price for that pathway is set — `price_cash` (USD) → guest, `price_points` → student.

**Non-negotiable invariants** (do not regress these):
1. **All prices are re-verified server-side** against Redis on every checkout. Client prices
   are never trusted.
2. **Stripe is webhook-confirmed only.** Never mark a guest order paid from the redirect.
3. **Airtable failures must never break a purchase** — keep all mirror calls fire-and-forget/no-throw.
4. **Idempotency + rate limits** on order creation stay intact.
5. **Cart clears only on confirmed success**, never on a cancelled/abandoned payment.
6. **Permission gates** (`AdminPermissions` in `src/types/Admin.ts`) are enforced on both the
   page and the API route for every admin action.

---

## 1. Goals (what "really good" means here)

Ship a cohesive set of upgrades across four tracks. Each item below is independently
shippable — prefer small, verifiable PRs over one mega-change. Preserve the Hack Club
visual identity (Phantom Sans, the brand palette, draggable-sticker playfulness) while
raising polish, accessibility, and operational power.

---

## 2. INVENTORY — Airtable-backed stock (highest-leverage new capability)

Today `ProductVariant.stock` is captured in the admin form, stored in Redis, and **never
enforced or surfaced**. Make inventory real, with **Airtable as the system of record for
stock levels** so non-engineer staff can manage it in a spreadsheet.

**Design:**
- Introduce an inventory sync that **reads** stock from the Airtable `Products`/variants
  table into Redis on a cadence (cron/route) and on-demand, caching in Redis
  (`inventory:{variantId}` with a short TTL) so the storefront stays fast and Airtable
  rate limits aren't hit on every page load. This is a *new* read direction — build it
  alongside the existing write-only mirror, don't break the mirror.
- Decide and document the **conflict rule**: Airtable is authoritative for stock; the app
  decrements a Redis "reserved/sold" counter on order, and the sync reconciles. Write this
  rule down in `docs/`.
- **Enforce stock at checkout** in BOTH paths:
  - `POST /api/orders` (student) and `POST /api/checkout/stripe` (guest) must re-check
    available stock server-side and reject oversells with a clear 409-style error.
  - For Stripe, decrement reserved stock when the session is created and **release the
    reservation if the session expires/cancels** (handle `checkout.session.expired`).
    Only convert reserved→sold on `checkout.session.completed`.
- **Surface stock in the UI**: "Only N left", "Out of stock" (disable Add to Cart),
  low-stock badges on `ProductCard` and the product detail page. Respect pathway — a
  variant with no price for the current pathway is already hidden; stock is an additional gate.
- **Admin inventory view**: a `/admin/inventory` page (gated by `canManageProducts`) showing
  every variant, current stock, reserved, sold, and a low-stock filter. Link out to the
  Airtable row for editing, plus an in-app quick-adjust that writes back through the mirror.
- **Backfill/repair**: extend or add to `/api/admin/airtable-backfill` so stock can be
  initialized from current Redis state without data loss.

**Acceptance:** A variant set to stock 0 in Airtable cannot be purchased on either pathway;
an abandoned Stripe session releases its reservation; the admin inventory page reflects
reality within one sync cycle.

---

## 3. CATALOG — discoverability & merchandising

The `category` field exists on `Product` but is unused; there is **no search, filter, sort,
or empty state** on `/shop`.

- **Search** (client-side over the fetched catalog is fine to start): name + description match.
- **Categories**: make `category` real — filter chips/tabs on `/shop`, category management in
  the admin product form. Backfill existing products to a default category.
- **Sort**: price (pathway-aware), newest, name.
- **Empty & loading states**: use the existing `Skeleton`/`CardSkeleton` for the initial
  product fetch (today the grid renders empty while loading), and a friendly empty state
  when filters match nothing.
- **Product detail upgrades**: image gallery (multiple images per product/variant), variant
  selection that previews the matching image, richer description (markdown?), related/"more
  from this category" rail.
- **Variant selector polish**: replace the bare `<select>` with an accessible, on-brand
  control; show color swatches and size pills instead of dropdown text where applicable.
- **Featured / new / sold-out** merchandising flags controllable from admin.

**Acceptance:** A shopper can search "sticker", filter to a category, sort by price, and see
correct pathway-aware prices and stock — on mobile and desktop.

---

## 4. ADMIN — operational power

Build on the existing dashboard, orders, products, users, coupons, admins, stats, projects.

- **Orders**: search/filter (by status, pathway, email/user, date range), pagination,
  CSV export, and a fulfillment workflow that captures **tracking number + carrier** and
  includes it in the "shipped" status email. Bulk actions (approve/fulfill multiple).
- **Stats**: richer analytics — revenue over time (chart), points spent vs. cash revenue
  split, conversion (carts → orders), top products already exists; add low-stock alerts and
  abandoned/expired Stripe sessions. Keep test orders excluded.
- **Products**: category + merchandising flags (see §3), bulk price edit, duplicate-product
  action, and inline image management for the new gallery.
- **Inventory**: the `/admin/inventory` page from §2.
- **Audit log**: record who did what (refunds, point grants, status changes) — a Redis
  append log surfaced in admin, since these are real money/points actions.
- **Coupons**: usage analytics (how many redeemed, revenue impact) and per-pathway coupon
  applicability if not already supported.

**Acceptance:** A store manager can find an order by customer email, mark it shipped with a
tracking number (customer gets an email with the link), and export the month's orders to CSV.

---

## 5. CUSTOMER EXPERIENCE — both pathways

- **Accessibility pass (do this early, it's currently weak)**: ARIA labels on icon buttons
  (cart, user, menu), `sr-only` text, focus management for the cart drawer and modals,
  keyboard operability, visible focus rings, and color-contrast checks against the brand
  palette. Target WCAG 2.1 AA.
- **Mobile polish**: tighten the `/checkout` form on small screens (currently cramped),
  ensure the country dropdown and address fields don't overflow, and give drag-to-cart a
  mobile-friendly equivalent (it's desktop-only today).
- **Checkout resilience**: loading spinner on the Stripe redirect button, a retry path on
  checkout errors, and clearer messaging when email isn't configured (don't fail silently).
- **Order history & tracking** (`/orders`, students; and a guest-accessible equivalent):
  show the tracking number/carrier link once fulfilled, an empty state, and a **reorder**
  button that repopulates the cart.
- **Guest order lookup**: since guests have no account, add an order-status lookup by
  email + order id (linked from the confirmation email) so guests can check status.
- **Cart cross-device for students**: optionally sync the logged-in student cart to Redis so
  it follows them across devices (localStorage stays the guest fallback). Keep the
  clear-on-confirmed-success-only invariant.
- **Thank-you page**: surface what happens next per pathway, and for guests keep the
  webhook-confirmed status polling but add a graceful "still processing" state.

**Acceptance:** A screen-reader user can complete a guest checkout; a student can reorder a
past order in two clicks; a guest can look up their order status from the email.

---

## 6. Cross-cutting / engineering quality

- **Tests**: there is currently **no test infrastructure**. Add a lightweight setup (Vitest
  recommended for this stack) and cover the highest-risk logic first: server-side price
  re-verification, stock enforcement/reservation/release, pathway filtering, coupon math,
  and the Stripe webhook state machine. Add an `npm test` script.
- **Types**: retire the legacy `ProductVariant.price` field cleanly once dual-pricing is
  fully relied upon, or document why it stays.
- **Docs**: update the stale `README.md` (says "COMING SOON"), and add `docs/` entries for
  the inventory sync model and the Airtable schema additions.
- **Error/observability**: make email-send failures visible to admins (they're silent
  no-ops today when unconfigured — fine for dev, but log/surface in prod).

---

## 7. How to work

1. **Plan first.** Propose an ordered backlog of small PRs across the four tracks; get the
   ordering confirmed before large changes. Recommended first slice: accessibility +
   catalog search/empty-states (low risk, high visible value), then the inventory system
   (highest leverage, most care needed around the Stripe reservation lifecycle).
2. **Respect the invariants in §0** on every change. When a change touches checkout or
   Stripe, call out explicitly how the invariant is preserved.
3. **Pathway-aware by default.** Every customer-facing change must be correct for both
   `student` and `guest`. Every price must be re-derived server-side.
4. **Keep Airtable safe.** New read sync must be cached and rate-limit-aware; all writes
   stay fire-and-forget.
5. **Ship verifiable increments.** Each PR: what changed, which acceptance criteria it meets,
   how to test it, and confirmation the build (`npm run build`) and lint pass. Add tests for
   new server logic.
6. **Don't regress the brand.** Phantom Sans, the Hack Club palette, the playful stickers and
   animations stay. Polish, don't sterilize.

---

## 7a. Pirate Ship / EasyPost shipping (shipped in the customer-flow track)

Pirate Ship has no public API — it runs on **EasyPost**, so the integration talks
to EasyPost for rates, labels, and tracking. It is config-gated and degrades to
manual tracking entry when unconfigured, mirroring the email/Airtable pattern.

**New env vars** (all optional; absence → manual-tracking-only fallback):
- `EASYPOST_API_KEY` — EasyPost key (`EZTK…` test / `EZAK…` prod).
- `SHIP_FROM_NAME`, `SHIP_FROM_COMPANY`, `SHIP_FROM_STREET1`, `SHIP_FROM_STREET2`,
  `SHIP_FROM_CITY`, `SHIP_FROM_STATE`, `SHIP_FROM_ZIP`, `SHIP_FROM_COUNTRY`,
  `SHIP_FROM_PHONE` — origin address postage ships from.
- `NEXT_PUBLIC_API_URL` / `NEXTAUTH_URL` — used to build the guest tracking link
  in confirmation emails (already present).

**New Airtable `Orders` columns** (add manually for staff visibility): `Carrier`,
`Tracking Number`, `Tracking URL`.

**Files added:** `src/lib/shipping.ts`, `src/lib/orderStore.ts`,
`src/app/api/admin/orders/[id]/shipping/route.ts`, `src/app/admin/orders/ShippingPanel.tsx`,
`src/app/api/orders/lookup/route.ts`, `src/app/orders/track/page.tsx`,
`src/app/api/cart/route.ts`. New `Order.shipment` field in `src/types/Order.ts`.

## 7b. Inventory — Airtable-backed stock (shipped)

Full model documented in `docs/INVENTORY.md`. Summary: Airtable `Products` is
authoritative for the base stock number; Redis caches it (`inventory:{variantId}`)
and holds the live `reserved` overlay (`inventory:{variantId}:reserved`).
`available = max(0, stock - reserved)`. A variant with no stock number is
unlimited (no migration needed). Guest/Stripe orders reserve → commit on paid /
release on expired; student/points orders commit immediately (no reservation
window). Both checkout paths fail closed on a proven oversell (409).

**New Airtable `Products` column:** `Total Stock` (roll-up; per-variant stock
lives inside `Variants JSON`, which the sync reads).

**Files added:** `src/lib/inventory.ts`, `src/app/api/admin/inventory/route.ts`,
`src/app/api/admin/inventory/sync/route.ts`, `src/app/admin/inventory/page.tsx`,
`docs/INVENTORY.md`. New `Order.inventoryHold`; `available` on the product APIs.
Enforcement wired into `checkout/stripe`, `webhooks/stripe`, `orders`, and admin
refund. Backfill seeds inventory from existing Redis stock.

## 7c. Catalog — discoverability (shipped)

`/shop` now has **search** (name + category), **category chips** (driven by the
real `Product.category`, which the admin form already manages), a **sort** control
(featured / price asc·desc — pathway-aware / newest / name), **CardSkeleton**
loading state for the initial fetch, and a **friendly empty state** with a clear-
filters action. All filtering layers on top of the existing pathway filter, so it
stays correct for both `student` and `guest`. `/api/products` now returns
`category` and `createdAt` per product.

## 7d. Sourcing — Vendor & Quote Vault (shipped — Admin OS Slice 1)

First slice of the connected admin OS (full spec in `ADMIN_OS_PROMPT.md`, model in
`docs/SOURCING.md`). A **vendor vault** and **quote vault** with quantity price-breaks,
plus a **compare-at-quantity** view that groups quotes by item and highlights the cheapest
**landed unit cost** (`tier price + setup/qty + shipping/qty`, via `landedUnitCost()` in
`src/types/Sourcing.ts`). New `canManageSourcing` permission (manager + store_manager),
gated on page and API. New Airtable mirror tables `Vendors` + `Quotes` (write-only,
fire-and-forget). Audit entries `sourcing.vendor.*` / `sourcing.quote.*`.

**Files added:** `src/types/Sourcing.ts`, `src/lib/sourcing.ts`,
`src/app/api/admin/sourcing/{vendors,quotes}/route.ts` + `[id]/route.ts`,
`src/app/admin/sourcing/{page,vendors/page,quotes/page}.tsx`, `docs/SOURCING.md`.
**Touched:** `airtableMirror.ts` (vendor/quote mirror), `auditLog.ts` (new actions),
`types/Admin.ts` (`canManageSourcing`), `admin/page.tsx` (Sourcing card).
**Not yet wired (defined in types):** PurchaseOrder, Asset — later slices.

## 7e. Sourcing — Quote→Product→PO→Receiving pipeline (shipped — Admin OS Slice 4)

The connective tissue (spec §3 of `ADMIN_OS_PROMPT.md`, model in `docs/SOURCING.md`).
**Accept a quote** → creates a **draft** `Product` (excluded from storefront; no price;
variant seeded with `unitCost = landedUnitCost`) and links the quote. **Start a PO** from
it (`draft → issued → in_transit → received`). **Receive** posts every line through the
existing **`receiveStock()`** costing ledger — the only path that moves stock + weighted-
avg cost. Idempotent via a **deterministic receipt id** `{poId}__{variantId}` (claimed in
`receiveStock`) plus a PO-level `receivedReceiptIds` guard; double-receive is a no-op.
Receiving is gated on `canManageFinance` (it moves cost basis); everything else on
`canManageSourcing`. New `Product.draft` + `ProductVariant.reorderPoint`; storefront
`/api/products` and `/api/products/[id]` now exclude drafts. New Airtable mirror table
`Purchase Orders`. Audit: `sourcing.quote.accept`, `sourcing.po.{create,status,receive,delete}`.

**Files added:** `src/app/api/admin/sourcing/quotes/[id]/accept/route.ts`,
`src/app/api/admin/sourcing/pos/route.ts` + `[id]/route.ts` + `[id]/receive/route.ts`,
`src/app/admin/sourcing/pos/page.tsx`. **Touched:** `lib/sourcing.ts` (PO CRUD +
idempotent `receivePO`), `airtableMirror.ts` (`mirrorPurchaseOrder`), `auditLog.ts`,
`types/Admin.ts` (`draft`, `reorderPoint`), `api/products` + `[id]` (draft filter),
`admin/sourcing/{page,quotes/page}.tsx` (POs card + pipeline buttons), `docs/SOURCING.md`.
## 7f. Sourcing — Asset manager + Command center (shipped — Admin OS Slices 3 & 5)

**Assets (Slice 3):** versioned design/art files (mockups, proofs, print-ready, source)
attachable to a product, quote, and/or PO via reverse indexes. Dedicated Blob upload
route (allows SVG/PDF/AI/EPS/ZIP up to 25MB — assets are downloaded, not rendered
inline). Reusable `AssetPanel` wired into quote rows + PO cards; uploading a new version
of a group bumps `version` and keeps history. New Airtable `Assets` table. Audit
`sourcing.asset.{create,delete}`.

**Command center (Slice 5):** `/admin` now leads with a live **"Needs attention"** feed
(`CommandCenter.tsx`) over one aggregation endpoint `GET /api/admin/overview` — reorder
(variants at/below `reorderPoint`, joined to cheapest open quote), unfulfilled orders,
quotes expiring ≤14d, overdue POs, uncosted variants (finance-only), recent audit. The
tool card grid stays below as secondary nav. Read-only, fire-and-forget, role-aware.

**Files added:** `src/app/api/admin/sourcing/assets/route.ts` + `[id]/route.ts`,
`src/app/admin/sourcing/AssetPanel.tsx`, `src/app/api/admin/overview/route.ts`,
`src/app/admin/CommandCenter.tsx`. **Touched:** `lib/sourcing.ts` (Asset CRUD),
`airtableMirror.ts` (`mirrorAsset`), `auditLog.ts`, `admin/page.tsx` (command center +
"All tools" heading), `sourcing/{quotes,pos}/page.tsx` (asset panels).

**The Admin OS program (`ADMIN_OS_PROMPT.md`) is now fully shipped** — all five slices.

## 8. Key files reference

| Concern | Files |
|---|---|
| Pathway fork | `src/lib/usePathway.ts`, `src/lib/paymentUtils.ts` |
| Types | `src/types/Order.ts`, `src/types/Admin.ts`, `src/types/Points.ts` |
| Catalog API | `src/app/api/products/route.ts`, `src/app/api/products/[id]/route.ts` |
| Student orders | `src/app/api/orders/route.ts`, `src/context/PointsContext.tsx` |
| Guest/Stripe | `src/lib/stripe.ts`, `src/app/api/checkout/stripe/route.ts`, `src/app/api/checkout/stripe/status/route.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/lib/guestOrders.ts` |
| Airtable | `src/lib/airtableMirror.ts`, `src/lib/airtable.ts`, `src/app/api/admin/airtable-backfill/route.ts` |
| Admin pages | `src/app/admin/**` (`page.tsx`, `orders/`, `products/`, `users/`, `coupons/`, `admins/`, `stats/`, `projects/`) |
| Admin auth | `src/lib/adminAuth.ts`, `src/app/api/admin/me/route.ts` |
| Storefront UI | `src/app/shop/page.tsx`, `src/app/products/[id]/page.tsx`, `src/app/checkout/page.tsx`, `src/app/thank-you/page.tsx`, `src/app/orders/page.tsx` |
| Components | `src/app/components/Navigation.tsx`, `CartModal.tsx`, `ProductCard.tsx`, `Skeleton.tsx` |
| Cart/state | `src/context/CartContext.tsx` |
| Email | `src/lib/email.ts` |
| Validation | `src/lib/productValidation.ts`, `src/lib/address.ts` |
