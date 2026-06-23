# Inventory model

How stock works in the Hack Club Shop, across Airtable, Redis, and the two
checkout pathways. Read this before touching `src/lib/inventory.ts` or either
checkout route.

## The shape of the problem

A variant can sell out, and we sell on two pathways at once:

- **Student (points)** orders settle **instantly** — points are internal, there's
  no external confirmation step. Stock can be decremented at order time.
- **Guest (Stripe)** orders have an **in-flight window**: the order is created
  `unpaid` when the Checkout Session is made, and only confirmed by the webhook
  seconds-to-minutes later. During that window the units must be held so two
  guests can't buy the last one, but they must be **released** if the session is
  abandoned/expires.

So stock is modelled as a base count plus an in-flight overlay.

## Source of truth

- **Airtable `Products` table is authoritative for the base stock number.** Staff
  manage stock in the spreadsheet (per variant, inside `Variants JSON`, and as a
  convenience `Total Stock` column). This is the number that means "how many we
  physically have to sell".
- **Redis is the operational store.** It caches the base stock for fast reads and
  holds the live `reserved` overlay that Airtable never sees.

Redis keys (per variant id):

| Key | Meaning | Written by |
|---|---|---|
| `inventory:{variantId}` | `{ stock, syncedAt }` — cached base stock from Airtable/Redis product | sync, admin quick-adjust |
| `inventory:{variantId}:reserved` | integer count of units held by in-flight Stripe sessions | reserve / release / commit |

**Available to sell** = `max(0, stock − reserved)`.

A variant with **no stock number set at all** (`stock === undefined`) is treated
as **unlimited** — this preserves today's behaviour for every existing product
until staff opt a variant into tracking by giving it a number.

## Reservation lifecycle (guest / Stripe)

```
checkout/stripe POST   → reserve(variant, qty)      reserved += qty
   │
   ├─ payment completes → webhook checkout.session.completed
   │                        → commit(variant, qty)  reserved -= qty ; stock -= qty
   │
   └─ session expires    → webhook checkout.session.expired
                            → release(variant, qty) reserved -= qty
```

- `reserve` happens **after** price/availability validation but **before** the
  Stripe session is created, and re-checks `available >= qty` so two simultaneous
  checkouts can't both grab the last unit. If reservation fails, checkout is
  rejected with a clear out-of-stock error and no Stripe session is made.
- `commit` is idempotent-safe: the webhook already guards on
  `paymentStatus === 'paid'`, so commit runs at most once per order.
- `release` only runs while the order is still `unpaid` (the webhook already
  checks this before marking the session expired/denied).
- The reserved qty per order is stored on the order itself
  (`order.inventoryHold`) so the webhook knows exactly what to commit/release
  without recomputing from the cart.

## Student / points orders

Points orders settle in the same request, so there is no reservation window:
they call `commit` directly (decrement available stock immediately) after points
are validated and before the order is saved. If `available < qty`, the order is
rejected before any points are deducted.

## Conflict rule (reconciliation)

Airtable is authoritative for the base number; Redis `reserved` is the in-flight
overlay that Airtable doesn't model. The sync (`syncInventoryFromAirtable`) reads
each variant's Airtable stock and overwrites the Redis `inventory:{variantId}`
base **without touching `reserved`**. So:

- Staff lowering stock in Airtable (e.g. after a manual count) wins on next sync.
- In-flight reservations are preserved across a sync (they live in a separate
  key), so a sync mid-checkout never double-frees a held unit.
- When we `commit` a sale we decrement the cached base stock in Redis, which is
  what gates further sales. Airtable is **not** decremented live — staff reconcile
  the spreadsheet during their next count, and the next sync re-seeds Redis from
  it. (`commitReserved` accepts an optional `mirror` callback if live write-back is
  wired later; today none is passed, so Redis leads Airtable between counts.)

Everything in `inventory.ts` is **fire-and-forget safe** like the email and
Airtable-mirror layers: a Redis/Airtable hiccup on a display/snapshot path
degrades to "treat as available" rather than blocking a purchase. The checkout
oversell check (`reserve`) is stricter: it reads stock via `readStockStrict`,
which **throws** on a Redis read error (vs. returning `null` for a clean miss), so
a transient read failure **fails closed** (rejects the reservation) instead of
silently disabling oversell protection. A clean miss still means "untracked →
unlimited".

Duplicate handling: every mutating entry point (`reserve`, `commitReserved`,
`release`, `restock`) `coalesce`s its lines by `variantId` first, so the same
variant appearing on multiple cart rows is counted once against one base read.

Webhook idempotency: Stripe delivers `checkout.session.completed`/`expired`
at-least-once. Before committing or releasing a hold, the webhook takes an atomic
one-time `claimOrderSettlement(orderId)` (Redis `SET NX`), so a duplicate or
concurrent delivery can't double-apply the stock change — the non-atomic
`paymentStatus` check alone is not enough.

## Enabling stock tracking on a variant

1. Give the variant a `stock` number (admin product form, or the
   `/admin/inventory` quick-adjust, or the Airtable `Variants JSON`).
2. Run a sync (the `/admin/inventory` "Sync from Airtable" button, or
   `POST /api/admin/inventory/sync`).
3. The storefront immediately reflects available stock and blocks oversells.

Variants left without a number stay unlimited — no migration required.
