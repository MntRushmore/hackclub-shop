# Finance & costing model

How the shop tracks **money tied up in inventory** — cost basis, valuation, cost
of goods sold (COGS), gross margin, purchasing spend, and the weekly report. This
is a separate layer from the operational stock model in
[`INVENTORY.md`](./INVENTORY.md): that one answers *"how many units can we sell"*,
this one answers *"how much did we pay, what's it worth, and what did we make"*.

Read this before touching `src/lib/costing.ts`, `src/lib/finance.ts`, or the
`/admin/finance` page. Finance must be able to trust and audit these numbers, so
every approximation is spelled out below.

## The two layers, side by side

| | Unit layer (`inventory.ts`) | Finance layer (`costing.ts` + `finance.ts`) |
|---|---|---|
| Question | How many can we sell right now? | How much did we pay / what's it worth / what did we make? |
| Per variant | `stock`, `reserved`, `available` | `unitCost` (weighted-avg), receipt ledger |
| Source of truth | Airtable base stock → Redis cache | `variant.unitCost` on the product record + `receipts:*` ledger in Redis |
| Mutates on sale | commit decrements stock | nothing — COGS is *read* from order lines |

The finance layer **never gates a sale** and never mutates stock except through the
same `setStock` path the admin quick-adjust uses. A Redis/Airtable hiccup degrades
to empty/zero, exactly like `email.ts` and `airtableMirror.ts`.

## Cost basis: weighted-average

Each variant carries an optional `unitCost` (USD per unit) — the **current standard
cost**, what we pay for one. It can be set by hand in the product form, or
recomputed automatically when stock is received.

**Receiving** (recording a purchase) is the heart of the model. When staff receive
`q` units at `c` dollars each (`/admin/finance` → "Receive stock", or
`POST /api/admin/finance/receiving`), `receiveStock()`:

1. writes an append-only **`Receipt`** (who/what/qty/cost/when/note),
2. recomputes the variant's weighted-average cost:

   ```
   newAvg = (oldUnits × oldAvg  +  recvUnits × recvCost) / (oldUnits + recvUnits)
   ```

   with guards for div-by-zero and a missing prior cost (a never-costed variant
   simply takes the received cost as its average — phantom $0 units don't drag it
   down; see `blendCost()`),
3. bumps unit `stock` by `q` through the product record **and** the inventory
   cache (`setStock`), so the two layers never drift,
4. records an audit entry (`inventory.receive`) and re-mirrors the product to
   Airtable.

We chose **weighted-average, not FIFO.** For the shop's volume it's the right
call: stable, easy for finance to reconcile, and it needs no per-receipt cost-layer
tracking. The trade-off is that valuation doesn't reflect which *specific* lot is
on the shelf — acceptable here.

**Idempotency:** receiving takes a one-time claim on the receipt id (`SET NX`,
mirroring `claimOrderSettlement`), so a double-click or retried request can't
double-count stock or double-blend cost. The dashboard generates a fresh
`receiptId` per submit.

**Untracked variants:** a variant with no `stock` number is "unlimited" on the
sell side. Receiving cost data for it sets its `unitCost` but does **not** convert
it to a counted variant — we don't let a cost entry silently change availability.

## COGS: captured point-in-time on the sale

When an order is placed, each line records the variant's `unitCost` **at that
moment** onto the `OrderItem` (`variantId` + `unitCost`), in
`validateCartItems()` (the trusted server-side path both checkout routes use). So
COGS is historically correct even if the variant's standard cost changes later.

```
line COGS = quantity × (item.unitCost   if captured at sale
                        else current variant.unitCost   ← "estimated" fallback
                        else 0)
```

Orders placed **before** this layer shipped have no line cost, so they fall back to
the variant's *current* cost and are flagged. The dashboard shows
`estimatedLineShare` — the fraction of sold lines using the fallback — so finance
knows how much of a period's COGS is exact vs. estimated.

## Cash vs. points — why margin is split

The shop sells on two pathways:

- **Guest / Stripe (cash):** real USD revenue. This is the true P&L line — the
  dashboard's **cash revenue − cash COGS = cash gross margin**.
- **Student / points:** $0 cash revenue, but the goods still cost us real money to
  buy. Folding points fulfilment into the same margin would make a heavy points
  week look like a catastrophic loss.

So we report them **separately**: cash margin is the headline; **points COGS**
(USD we spent fulfilling points orders) and **points spent** (internal points) are
shown on their own. `totalCogs = cashCogs + pointsCogs` is the real cost of
everything that left the building.

## Valuation

```
variant value      = on-hand units × unitCost     (0 if either is unknown)
inventory value    = Σ variant value
```

**On-hand = `variant.stock`** — what we *physically* hold. Reserved (in-flight
Stripe) units are still ours until the sale commits, so they count toward
valuation. Untracked (unlimited) variants contribute 0 — there's no finite count to
value. The dashboard surfaces **cost coverage** (% of tracked variants that have a
cost) and an **uncosted count** so gaps are visible, not hidden.

## Weekly report

`getWeeklyReport(dateInWeek)` rolls up one ISO week (Mon–Sun): units sold, cash
revenue / COGS / margin, points COGS + points spent, units received + spend, and
the **ending inventory value** + low-stock + dead-stock flags at report time.

- **Low stock:** available ≤ 5 (from the unit layer).
- **Dead stock:** holds value but hasn't sold in 8 weeks — capital sitting idle.

It's exportable as **formula-injection-safe CSV**
(`/api/admin/finance/weekly/export?week=YYYY-MM-DD` — leading `=,+,-,@` cells are
prefixed with `'`, matching the orders export). No email/scheduling is wired; the
week picker + CSV is the delivery mechanism.

## Redis keys

| Key | Meaning | Written by |
|---|---|---|
| `receipts:log` | capped list (2000) of all receipts, newest first | `receiveStock` |
| `receipts:variant:{variantId}` | capped list (200) of one variant's receipts | `receiveStock` |
| `receipts:claim:{receiptId}` | idempotency claim (30-day TTL) | `receiveStock` |
| `variant.unitCost` (on `product:*`) | current weighted-avg cost | `receiveStock`, product form |

Order/product enumeration reuses the same patterns as `/api/admin/stats`
(`user:*:orders` arrays + `order:*` singles + `product:*`). Test orders (`isTest`)
are excluded from every aggregate.

## Access

All finance reads and receiving require the **`canManageFinance`** permission
(managers only by default), gated on both the page and every API route. This keeps
cost basis and margin separate from order stats (`canViewStats`) and product
editing (`canManageProducts`).

## Known approximations (tell finance these)

1. **Legacy orders** (pre-finance-layer) use current variant cost as an estimate —
   tracked via `estimatedLineShare`.
2. **Weighted-average**, not FIFO — valuation doesn't track specific lots.
3. **Redis leads Airtable between counts** for live stock (inherited from the unit
   layer) — valuation uses the live Redis base, reconciled on the next sync.
4. **Refunds** are excluded from COGS/margin (status `refunded`/`denied` skipped),
   but a refund that restocks goes through the unit layer's `restock`, not a
   negative receipt — so refunded units re-enter valuation at the variant's current
   average, not their original cost. Acceptable at this volume.
