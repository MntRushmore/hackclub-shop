# Donation Pivot — "Back a Teenager, Get the Merch"

Spec for pivoting the shop from retail pricing to a donation-based model: you donate at a
tier, and the merch is the thank-you gift (the NPR-tote-bag model). Written 2026-07-06.

## Why (the math)

The retail model's absolute ceiling — every unit sells at suggested price — is **$18,151
gross profit** on $18,599 of COGS (49.4% margin). The donation model re-anchors price to
generosity instead of garment value:

| Gift | COGS | Retail price | Donation ask | Margin |
|---|---|---|---|---|
| Sticker pack | $1.90 | $5 | **$25** | 92% |
| Mug | $7.12 | $18 | **$100** | 93% |
| Tote | $14.40 | $30 | **$100** | 86% |
| T-Shirt | $18.20 | $35 | **$150** | 88% |
| Cap | $15.94 | $32 | **$150** | 89% |
| College Sweatshirt | $34.50 | $70 | **$250** | 86% |
| Mom Sweatshirt | $37.38 | $75 | **$250** | 85% |
| Investor Vest | $53.70 | $95 | **$500** | 89% |

Scenarios on the same inventory (100x each, 250 stickers):

- **Full sellout:** $156,250 revenue − $18,599 COGS = **~$137,650 net** (7.6× retail ceiling)
- **25% sell-through:** ~$39,000 revenue − ~$4,650 COGS = **~$34,400 net** (still ~1.9× retail ceiling)
- **Breakeven vs. retail's *best* case:** only **~13% sell-through** needed at donation prices

The bet: fewer transactions, dramatically more per transaction. Parents (the audience per
the store-v2 pivot) are not buying a sweatshirt — they're backing their kid's community
and getting a badge of pride for it.

## Tier ladder

Tiers are identity, not price points. Each has a name, a concrete impact statement, and a gift.

| Tier | Donation | Gift | Impact statement |
|---|---|---|---|
| **Supporter** | $25 | Sticker pack | Covers a teen's domain + dev tools for a year |
| **Friend** | $100 | Mug **or** tote (choice) | Sends a teen to their first hackathon — where they find their people |
| **Champion** | $150 | Tee **or** cap (choice) | Funds a teen's first hardware project grant |
| **Patron** | $250 | Sweatshirt (College or "Mom" — choice) + sticker | Backs a teen through a summer of building |
| **Philanthropist** | $500 | **Numbered vest** — only 100 exist | Puts a laptop in the hands of a teen coding on a school Chromebook |
| **Founder's Circle** | $1,000 | The full kit (vest + sweatshirt + tee + cap + mug + tote + stickers, ~$150 COGS) | Sponsors a teen's entire year — laptop, travel, grants |

Design rules:
- The **numbered vest is the flagship**: the Philanthropist tier is numbered 1–100 and
  *only* available at $500+. Scarcity is real, not
  manufactured — we bought 100.
- Impact statements map to real funds (below) and appear on the tier card, at checkout, and
  in the receipt email.
- Cash-value framing is banned from tier cards. Never "worth $95" — always "our thanks."
  (FMV appears only in the tax-disclosure fine print, where the IRS requires it.)

## Where the money goes (fund picker)

At checkout the donor directs their donation to one of:

1. **Laptop Fund** — refurbished laptops for teens without their own machine ($500 ≈ 1 laptop)
2. **First Hackathon Fund** — travel stipends so a teen can meet their community IRL ($100 ≈ 1 stipend)
3. **Gap Year / Big Project Fund** — backing teens taking time to build something real
4. **Wherever it's needed most** (default)

The homepage's existing "Where the money goes" dark band (`src/app/page.tsx:98`) becomes
this fund picker's marketing surface, each fund with a live progress meter ("23 laptops
funded so far").

## Appeal mechanics (in priority order)

1. **Tax deduction, front and center.** Hack Club is a 501(c)(3) (EIN 81-2908499, already
   on the homepage FAQ). Donation minus the gift's fair market value is deductible — a $500
   Philanthropist donation is ~$405 deductible. Show this on the tier card and receipt. (IRS
   quid-pro-quo disclosure is *required* for contributions over $75, so this is compliance
   and marketing in one.)
2. **Employer matching.** Post-checkout screen + receipt email: "Your employer may double
   this." A matched $500 is $1,000 at zero marginal cost. Parents at big tech companies are
   exactly this audience.
3. **Donor wall / leaderboard.** Public page (`/donors`): family name, tier badge, fund,
   optional dedication. Sorted by tier then recency. Anonymity checkbox at checkout.
   Founder's Circle gets a permanent top section.
4. **"In honor of" dedication.** Parents donate in their teen's name — "The Chen Family, in
   honor of Maya 💛". This is the emotional hook that turns a purchase into a statement.
5. **Impact meter on the homepage.** Aggregate progress bar: "$X raised · Y laptops · Z
   hackathon trips." Live numbers from the orders store.
6. **Numbered vests.** Each Philanthropist-tier vest ships with its number (1–100) on the
   label/card: "Vest #042 of 100."
7. **Sustainer tier (later).** $25/mo recurring → annual thank-you gift + permanent wall
   spot. Stripe subscriptions; ship after one-time tiers prove out.

## Implementation plan

Pricing already flows through Stripe Prices → checkout → webhook → Order, so tiers slot
into the existing pipeline rather than replacing it.

### Slice 1 — Tier catalog + checkout (core)
- Model tiers as Stripe Products with `metadata.config` gaining `donation: { tier: string,
  fmvCents: number, impactStatement: string }` (extend `parseProductConfig` in
  `src/lib/catalogMapping.ts`). The donation amount is the Price; the gift is fulfillment
  metadata, not a priced line item.
- Checkout (`src/app/api/checkout/stripe/route.ts`): gift choice (mug vs. tote etc.)
  becomes a variant selection; add fund picker + dedication + anonymity fields (reuse
  `checkoutFields`). Keep the existing inventory-hold flow — gifts still consume stock.
- **Tax:** the donation portion above FMV is not a sale. Recommended: set the tier product's
  Stripe tax code to the donation code and apply `GENERAL_GOODS_TAX_CODE` only to the FMV
  portion — needs a decision with whoever owns tax/compliance before launch. (This is the
  one open legal question; everything else is engineering.)
- `Order` type (`src/types/Order.ts`): add `donation?: { tier, fundId, fmvCents,
  dedication?, displayName?, isAnonymous }`.
- Receipt email: IRS acknowledgment language with FMV disclosure + employer-match nudge.

### Slice 2 — Storefront rework
- `/shop` becomes the tier ladder (6 cards, not a product grid). Order: anchor high —
  Founder's Circle and Philanthropist first.
- Homepage: hero copy shifts from "shop to support" to "back a teenager" ; "Where the money
  goes" band → fund cards with meters; FAQ gains "Is this tax-deductible?" and "Why does a
  mug cost $100?" (answer: it doesn't — the mug is free, the $100 is a laptop fund
  contribution... this reframe IS the pitch).
- Keep the student points pathway untouched (per store-v2 invariants: points are money,
  server-only; admin buy-everything unchanged).

### Slice 3 — Donor wall + impact meter
- Redis: `donors:wall` sorted list written by the Stripe webhook on payment success
  (never client-side, same trust model as points). `/donors` page, tier badges,
  dedications, anonymous entries shown as "Anonymous Philanthropist."
- Impact aggregates (`impact:fund:{id}` counters) power homepage meters.
- Vest numbering: atomic Redis counter assigned at order creation, stored on the order,
  printed on the packing slip (barcode/label pipeline already exists).

### Slice 4 — Growth loops
- Employer-match follow-up email (extend CONVERSION_EMAILS.md campaign).
- Social share card per donation ("We hold vest #042") — OG-image pipeline already exists.
- Sustainer recurring tier.

## Invariants
- Points/student pathway is untouched; this changes the **guest/parent** pathway only.
- Donor wall and impact counters are webhook-written only — no client mutation endpoint.
- Every tier card shows the impact statement; FMV/tax language lives in fine print + receipt.
- Gifts consume real inventory through the existing hold/receive pipeline (`receiveStock()` rules apply).

## Status

- **Slice 1 — SHIPPED 2026-07-06.** Donation config on catalog products
  (`config.donation` in Stripe Product metadata → `CatalogProduct.donation`), checkout
  splits each donation line into a taxable gift-FMV line + a nontaxable donation line
  (`NONTAXABLE_TAX_CODE`), orders carry an `OrderDonation` summary (amount / FMV /
  deductible / fund / dedication / anonymity, donor input sanitized in
  `src/lib/donation.ts`), and the confirmation email doubles as the IRS quid-pro-quo
  acknowledgment with an employer-match nudge. Seed script:
  `node scripts/seed-donation-tiers.mjs [--dry-run]` (idempotent; set variant stock
  after seeding — the numbered vest must cap at 100).
- **Slice 2 — SHIPPED 2026-07-06.** `/shop` renders a donation tier ladder (biggest ask
  first; retail grid remains below only when non-tier products exist, e.g. admin mode);
  product pages reframe tiers ("Choose your thank-you gift", "Donate $X →", deductible
  line); checkout gains the fund picker + dedication + donor-wall name + anonymity and
  sends `donation` in the POST; homepage hero/story/FAQ/dark band reframed around
  "back a teenager" with the three funds ("Why does a mug cost $100?" FAQ added).
  Donation config flows through `/api/products` and `/api/products/[id]`.
- **Slice 3 — SHIPPED 2026-07-06.** `src/lib/donorWall.ts` (webhook-only writes, same
  trust model as points): `donors:wall` zset + `impact:*` counters + atomic
  `vest:number` counter (minted at payment settlement — abandoned checkouts never
  burn a number; capped at 100 across Philanthropist + Founder's Circle). Public `/donors`
  page (anonymous entries stripped of name AND dedication via an explicit field
  allowlist), homepage fund cards show live meters ("$X raised · N laptops funded") +
  total + donor-wall link, "Donors" in the nav, receipt email carries the
  "Your vest is #042 of 100" badge, staff order alert says which vest number to print on
  the packing slip. Homepage/donors Redis reads wrapped in unstable_cache (300s/60s)
  so both stay static.
- **Slice 4 — SHIPPED 2026-07-06.** Growth loops:
  - *Employer-match follow-up*: daily Vercel cron (`vercel.json` →
    `/api/cron/match-followup`, auth `CRON_SECRET`, fail-closed) emails each donor once,
    3–14 days after settlement ("One search could double your $500"), respecting
    marketing suppression; sent-state stamped on `order.donation.matchEmailSentAt`;
    donation orders indexed in the `donations:orders` zset by `recordDonation`.
  - *Share cards*: thank-you page shows a share block for donation orders ("You're
    vest #042 of 100") with X-intent + copy buttons; share URL is
    `/backed?t=<tier>&n=<num>` whose OG image renders via `/api/og/backed`
    (`src/lib/shareCard.ts` allowlists tier + number 1–100, so params can't inject).
  - *Sustainer*: $25/mo subscription checkout (`/api/checkout/sustain`, price
    find-or-create by lookup_key `sustainer_monthly`, donor-wall name as a Stripe
    custom field, nontaxable product code). Webhook: subscription
    `checkout.session.completed` → wall entry + first month's impact;
    `invoice.paid` (billing_reason subscription_cycle, metadata snapshot on
    `invoice.parent.subscription_details`) → impact bump; both idempotent via
    settlement claims. Dark Sustainer card sits last in the /shop ladder.
- Still open: vest number on the physical packing slip via the barcode/label pipeline
  (staff email carries it for now); annual Sustainer gift fulfillment is manual;
  `CRON_SECRET` env must be set in Vercel for the cron to run.

## Open questions
1. Finance/tax/legal questions: asked 2026-07-06, tracked with per-answer code knobs in
   **FINANCE_QUESTIONS.md** — tweak the platform from there as answers land.
2. Do Founder's Circle bundles reserve inventory across all SKUs at order time, or fulfill
   from remaining stock? (Recommend: reserve at order time, it's only ~$150 COGS per $1,000.)
3. Mug at $100 vs. $50 entry gift — current ladder follows the "$100 mug" framing; if the
   $25→$100 gap suppresses conversion, insert a $50 Friend tier with the mug and move
   tote up to $100.
