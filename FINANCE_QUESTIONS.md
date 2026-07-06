# Finance questions — donation pivot (asked 2026-07-06, answers pending)

Questions sent to the finance team about the donation-based shop
(DONATION_PIVOT_PROMPT.md). Each question lists the exact code/config knob to
tweak when the answer comes back — fill in the **Answer:** line and adjust.

## Blocking launch — tax treatment

### 1. Sales tax on the gift portion
We charge sales tax only on the thank-you gift's fair market value; the donation
above FMV is billed with Stripe's Nontaxable code. Correct in every state where
we're registered for Stripe Tax? Does The Hack Foundation have exempt-SELLER
status anywhere (some states exempt nonprofit sales entirely)?

- **Answer:** _pending_
- **Knob:** the split in `src/app/api/checkout/stripe/route.ts` (donation branch
  of the line-item builder) + `NONTAXABLE_TAX_CODE` in `src/lib/stripe.ts`.
  If tax should apply to the full amount → drop the split, bill one goods line.
  If exempt-seller everywhere → tax code on the FMV line can go nontaxable too,
  or turn `STRIPE_TAX_ENABLED` off for donation-only carts.
  Also covers the **Sustainer** $25/mo subscription (`/api/checkout/sustain`):
  currently treated as a pure donation (nontaxable, no automatic tax) since no
  gift ships monthly — but the annual thank-you gift has FMV; confirm whether it
  needs a yearly FMV disclosure on the anniversary receipt.

### 2. FMV values per tier
We disclose FMV = suggested retail: sticker $5, mug/tote $30, tee/cap $35,
sweatshirt+sticker $80, vest+sticker $100, full kit $290. Sign off?

- **Answer:** _pending_
- **Knob:** `fmvCents` per tier in `scripts/seed-donation-tiers.mjs` (re-run to
  update) or edit `config.donation.fmvCents` directly on the Stripe Product.
  Existing orders keep their captured values (`Order.donation.fmvAmount`).

### 3. Receipt language / legal name
Receipt says "Hack Club is a registered 501(c)(3) nonprofit (EIN 81-2908499)…
no other goods or services were provided…". Does it need "The Hack Foundation
d/b/a Hack Club"? Does the wording satisfy IRS Pub. 1771 for quid-pro-quo
contributions over $75?

- **Answer:** _pending_
- **Knob:** `donationText()` / `donationHtml()` in `src/lib/email.ts` (marked
  "change only with finance sign-off").

## Blocking launch — legal / ops

### 4. Charitable solicitation registration
Soliciting donations online nationwide can require state registration (~40
states). Is The Hack Foundation registered, or does counsel need to scope this
before the storefront flips?

- **Answer:** _pending_
- **Knob:** launch gate only; possibly a state-based disclosure footer on the
  homepage/checkout if counsel requires one.

### 5. Fund restrictions vs. preferences
Fund picker: Laptop / First Hackathon / Gap Year / general. Binding restricted
funds (restricted-fund accounting) or donor *preferences* ("we'll direct your
gift where it's needed most")?

- **Answer:** _pending_
- **Knob:** fund names/descriptions + disclaimer copy in `DONATION_FUNDS`
  (`src/lib/donation.ts`) and the fund-picker label on the checkout page. If
  preferences: add "gifts are preferences, not restrictions" line to picker +
  receipt.

## Important, not blocking

### 6. Bookkeeping split
Book donation orders as part-sale (FMV as merch revenue with COGS) /
part-contribution? Orders record `donation.amount`, `fmvAmount`,
`deductibleAmount` explicitly to support this.

- **Answer:** _pending_
- **Knob:** finance reporting/`airtableMirror` fields; no checkout change.

### 7. Employer matching listing
Which name is listed in Benevity/YourCause/etc.? Receipt tells donors to search
"Hack Club" or "The Hack Foundation".

- **Answer:** _pending_
- **Knob:** match-nudge copy in `src/lib/email.ts`; later the post-checkout page.

### 8. Refund policy for donations
Policy + required language?

- **Answer:** _pending_
- **Knob:** FAQ on homepage + receipt footer; admin refund flow unchanged.

### 9. International donors
Any concern accepting foreign donations with gifts shipped abroad
(deductibility is US-taxpayer-only)?

- **Answer:** _pending_
- **Knob:** `ALLOWED_COUNTRIES` in the checkout route; a "deductible for US
  taxpayers" caveat in receipt/FAQ copy.

### 10. Year-end summaries
Consolidated annual giving statements for repeat donors (matters once the
recurring Sustainer tier ships)?

- **Answer:** _pending_
- **Knob:** future Slice 4 work item; order store already keyed by guest email.
