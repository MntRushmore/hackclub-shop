# VIP Elevation — "You Didn't Buy Merch. You Joined Something."

Spec for making the shop feel like the front door of an elite program: donating here should
feel like being admitted to a small, serious circle of people who back exceptional teenagers.
Written 2026-07-07. Builds on DONATION_PIVOT_PROMPT.md (tier ladder) and the store-v2
parent-facing pivot.

## The thesis

Parents don't brag about buying a hoodie. They brag about their kid being in something
selective, and about being the kind of family that backs it. Right now the site is warm and
proud, but it reads as "friendly nonprofit shop." The upgrade: make it read as **a patron
program with real scarcity, real recognition, and real access**, without losing the Hack Club
voice.

Two audiences for "elite," and we serve both:

1. **Hack Club is elite** — the teens are extraordinary and the site should prove it, not
   just assert it. Shipped projects, real photos, real numbers.
2. **Being a donor is elite** — small numbered circles, permanent recognition, insider
   access. You didn't check out; you were admitted.

## What VIP means here (and what it does NOT mean)

VIP = **earned exclusivity**: scarcity that is true, recognition that is permanent, access
that is real. It is achieved with restraint, hierarchy, and specificity.

VIP does NOT mean luxury-brand pastiche. No black-and-gold redesign, no serif logotype, no
champagne copy. Hack Club's brand (Phantom Sans, brand red, doodles, teenage energy) stays.
The elite feel comes from *how much we hold back*: quieter pages at the top tiers, fewer
words, real numbers, and one flagship object (the numbered vest).

## What already exists (build on it, don't rebuild)

- **Numbered vest machinery** — atomic INCR capped at 100, number printed on packing slip
  and receipt (`src/lib/donorWall.ts`, `src/types/Order.ts`). Scarcity is real: we bought 100.
- **Donor wall** at `/donors` with tiers, dedications, anonymity (`src/lib/donorWall.ts`).
- **Share cards** (`src/lib/shareCard.ts`) and a thank-you page (`src/app/thank-you/`).
- **Fund preferences + live impact meters** on the homepage (`src/app/page.tsx`).
- **Founder's Circle** tier at $1,000+ with the full kit and extra-donation top-up
  (`src/lib/donation.ts`).

## Idea inventory

### Track A — Scarcity you can watch (highest leverage, mostly display work)

1. **Live vest counter everywhere the vest appears.** "Vest No. 38 of 100 was claimed last
   week" on the Philanthropist tier card, the homepage merch shelf, and the shop page. The
   count comes from the existing INCR value; never a hardcoded number.
2. **Your number, the moment you earn it.** Thank-you page says "You are Philanthropist
   No. 41" the second checkout completes. The number is the product.
3. **Retired, not sold out.** When the 100th vest goes, the tier card stays visible forever,
   marked "All 100 numbers claimed," with the donor wall list beneath it. Sold-out-as-monument
   is stronger social proof than availability.
4. **Low-number prestige.** Show the vest number on the donor wall next to the name. Number
   7 outranks number 94 without us saying a word.

### Track B — Membership, not checkout (framing + copy)

5. **Name the circles.** The tier ladder becomes a set of named circles ("The Founder's
   Circle" already exists; extend the register: Supporter → Friend → Champion → Patron →
   Philanthropist reads as an honors ladder if we present it as one). Tier pages say "Join
   the Patron circle," never "Buy the Patron tier."
6. **Member numbers for every tier.** A global donor sequence ("Backer No. 214 since June
   2026") on the receipt, thank-you page, and optionally the wall. One more atomic counter,
   same pattern as the vest.
7. **Admission language in the checkout flow.** Post-payment copy shifts from
   transactional to ceremonial: "Welcome to the Patron circle. Your name goes on the wall
   today; your gift ships this week." Small copy change, large felt difference.
8. **The wall becomes a registry.** `/donors` gets hierarchy: Founder's Circle in a
   permanent top band with more visual weight, vest numbers listed, dedications rendered
   like inscriptions. Quiet typography, generous space. This page should feel like a
   plaque in a lobby, not a comment feed.

### Track C — Artifacts (things donors keep and show)

9. **Certificate of patronage.** A downloadable, print-quality certificate on the
   thank-you page and receipt email: donor name, circle, number, dedication, date, EIN.
   Server-rendered like the existing share cards. Parents put these on refrigerators and
   office walls; that is unpaid acquisition.
10. **Share card upgrade.** The existing share card gets tier-aware art: Philanthropist
    and Founder's Circle cards carry the number ("No. 41 of 100") so sharing them
    broadcasts scarcity.
11. **In-the-box ceremony.** Packing-slip copy and a printed card in the box that repeats
    the number and circle. The unboxing should confirm the status the website promised.
    (Copy + packing-slip template work; no new systems.)

### Track D — Access (the hardest to fake, the most convincing)

12. **The dispatch.** A donors-only email, a few times a year, showing what teens shipped:
    real projects, real photos, links to the actual repos and demos. This is the proof
    that Hack Club is elite, delivered only to insiders. Reuses the existing email
    infrastructure; content pipeline is the real cost.
13. **First look for upper circles.** New merch drops open to Philanthropist and Founder's
    Circle donors before the public shop. Config-gated early-access window on new
    products; small code, real privilege.
14. **A human at the top.** Founder's Circle checkout confirmation comes with a real
    person's name and email, and an invitation to talk. Above the extra-donation ceiling
    the site already says "talk to us"; make the person visible sooner.

### Track E — Prove the program is elite (homepage + shop)

15. **Show shipped work, not adjectives.** A homepage band of 3-5 real teen projects with
    one-line descriptions and links. "Elite" asserted is marketing; "elite" demonstrated is
    a screenshot of a thing a 16-year-old shipped.
16. **Numbers with receipts.** Only verified stats (donor count and dollars raised already
    exist and are live from Redis). If we want program-scale stats (clubs, countries,
    events), source them from hackclub.com and verify before use.
17. **Design restraint pass on the tier ladder.** Top tiers get quieter, more spacious
    cards: more whitespace, fewer badges, smaller type doing more work. The $25 tier can
    be cheerful; the $1,000 tier should be calm. Hierarchy through restraint is the whole
    trick.

## Guardrails (non-negotiable)

- **No manufactured scarcity.** Every number shown is read from real state (stock, INCR
  counters). No countdown timers, no fake "only 3 left," no urgency theater. The vest is
  scarce because we bought 100; that is the only kind of scarcity this site uses.
- **Copy rules hold.** No em dashes in user-visible copy. No outcome claims (funds are
  donor preferences). Dollar-cost claims only where already verified ($500 laptop OK).
  Cash-value framing stays banned from tier cards; FMV lives in the tax fine print.
- **Brand stays Hack Club.** Phantom Sans, brand red, real photos. Elevation through
  restraint and hierarchy, not a luxury reskin.
- **Compliance unchanged.** IRS quid-pro-quo disclosure, FMV split, receipt language all
  stay exactly as built (see stripe-tax-migration).
- **Server invariants untouched.** Points remain server-mutate-only; stock through
  `receiveStock()`; new counters follow the vest pattern (atomic, server-side, append-only).
- **Admin pages** use the shared `/admin` shell; no new auth gates.

## Suggested phasing

- **Phase 1 (a weekend):** Tracks A + B — live vest counter, member numbers, admission
  copy, registry-style donor wall. Almost entirely display and copy over existing state.
- **Phase 2:** Track C — certificate, tier-aware share cards, packing-slip ceremony.
- **Phase 3:** Track E — shipped-work band, tier-ladder restraint pass.
- **Phase 4 (needs humans, not just code):** Track D — the dispatch, early access,
  named contact for Founder's Circle.

## Open questions (ask before building)

1. Global donor sequence: number every donor from the beginning, or start at the current
   count? (Backfilling from existing orders is possible and more honest.)
2. Early access (idea 13): does ops want the fulfillment complexity of gated drops?
3. The dispatch (idea 12): who owns the content? Ship the infrastructure only when someone
   commits to writing issue No. 1.
4. Certificate design: same visual system as the share card, or a distinct formal artifact?
5. Should the member number appear on the public wall by default, or receipt-only until
   donors opt in?
