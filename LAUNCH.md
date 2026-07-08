# Launch Runbook

The exact sequence to take shop.hackclub.com from the test-account setup to
live payments. Everything is idempotent; re-run any step safely.

## 0. Where the keys go

You have four Stripe credentials. They live in two places:

| Credential | Local `.env.local` | Vercel production env |
|---|---|---|
| Live secret key (`sk_live_...`) | `STRIPE_LIVE_KEY=` (new line — used ONLY by scripts; local dev stays on the test account) | `STRIPE_SECRET_KEY` |
| Live webhook signing secret (`whsec_...`, from step 2) | not needed | `STRIPE_WEBHOOK_SECRET` |
| Test secret key (`sk_test_...`) | `STRIPE_SECRET_KEY` (already there) | `STRIPE_SECRET_KEY_TEST` |
| Test webhook signing secret (from step 3) | already there as `STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET_TEST` |

Never put the live key in `.env.local`'s `STRIPE_SECRET_KEY` — that would point
local dev (catalog cache rebuilds, checkouts) at the real store.

Vercel env commands (project is on the `hackclub` team):

```
vercel env add STRIPE_SECRET_KEY production --scope hackclub          # paste sk_live_...
vercel env add STRIPE_WEBHOOK_SECRET production --scope hackclub      # paste live whsec_...
vercel env add STRIPE_SECRET_KEY_TEST production --scope hackclub     # paste sk_test_...
vercel env add STRIPE_WEBHOOK_SECRET_TEST production --scope hackclub # paste test whsec_...
```

## 1. Seed the live catalog (from the test catalog)

The whole catalog (6 donation tiers + retail products, with all shop metadata)
currently lives in the TEST account. Copy it to live:

```
node scripts/copy-catalog-to-test.mjs --to-live --dry-run       # preview first
node scripts/copy-catalog-to-test.mjs --to-live --confirm-live  # then write
```

Requires `STRIPE_LIVE_KEY` in `.env.local`. Inventory does NOT need copying —
stock lives in Redis keyed by `variant_id`, which the copy preserves.

## 2. Live webhook endpoint (Stripe Dashboard, LIVE mode)

Developers → Webhooks → Add endpoint:

- URL: `https://shop.hackclub.com/api/webhooks/stripe`
- Events: `checkout.session.completed`, `checkout.session.expired`,
  `invoice.paid`, `product.created`, `product.updated`, `product.deleted`,
  `price.created`, `price.updated`, `price.deleted`
- Copy its signing secret → Vercel `STRIPE_WEBHOOK_SECRET`.

Without this, cards get charged but orders never finalize — the webhook is the
only trusted paid signal.

## 3. Test webhook endpoint (Stripe Dashboard, TEST mode)

Same URL, same events, created while toggled into test mode. Its signing
secret → Vercel `STRIPE_WEBHOOK_SECRET_TEST`. This is what makes the admin
test-mode toggle fully functional in production (test checkouts finalize too).

## 4. Stripe Tax

`STRIPE_TAX_ENABLED=1` is only safe once tax registrations exist in the LIVE
dashboard (Settings → Tax). Until then leave it unset in Vercel — checkout
works, just without a tax line. (`STRIPE_TAX_ENABLED_TEST` likewise for the
test slot.)

## 5. Confirm the rest of the production env

Required: `UPSTASH_REDIS_REST_URL/TOKEN`, `NEXTAUTH_URL/SECRET`,
`HACKCLUB_CLIENT_ID/SECRET`, `GLOBAL_ADMINS`, plus the Stripe vars above.

Operational (silently degraded without them): `EASYPOST_API_KEY`,
`EASYPOST_WEBHOOK_SECRET` (set it — unsigned delivery webhooks are accepted
otherwise), `SHIP_FROM_STREET1/CITY/STATE/ZIP`, `EMAIL_PROVIDER` +
`RESEND_API_KEY`/`POSTMARK_TOKEN`, `EMAIL_FROM`, `CRON_SECRET` (both crons
refuse to run without it), `BLOB_READ_WRITE_TOKEN`, `ADMIN_ORDER_EMAIL`.

## 6. Deploy + rebuild the catalog cache

Deploy (or redeploy after the env changes). Then, signed in as an admin:

```
POST https://shop.hackclub.com/api/admin/catalog/rebuild   {"confirm": true}
```

This is REQUIRED: the storefront cache stores per-account Stripe price ids.
Until the rebuild, checkout would try to bill test-account price ids against
the live account and fail.

## 7. Verify on /admin/finance

The Payments card should show: **Connected**, **Live mode** badge, account
name/email correct, webhook configured, and Checkout mode **Live** for
everyone.

## 8. End-to-end test WITHOUT real money

On the Payments card, set **Just me → Test**. Run a full checkout with card
`4242 4242 4242 4242` (any future expiry/CVC). Confirm: order appears in
/admin/orders with the TEST badge, confirmation email arrives, thank-you page
flips to paid. Set **Just me → Follow store** when done. Test orders never
touch stats, finance, the warehouse queue, or the donor wall.

## 9. One real transaction

Buy the $25 tier with a real card. Confirm the order finalizes, the donor wall
updates, and finance shows it. Refund it from /admin/orders (the refund goes
through Stripe automatically) — this proves the whole loop including refunds.

## 10. Watch after launch

- /admin/finance and /admin/stats (revenue should match Stripe)
- Stripe Dashboard → Webhooks (delivery failures)
- Vercel cron logs: `reconcile-holds` (every 6h; `needsHuman` entries mean a
  missed completion webhook — finalize those by hand), `match-followup` (daily)

## Rollback

If live checkout misbehaves: on /admin/finance flip **Everyone → Test** — real
cards can no longer be charged while you debug (guests see test mode; treat it
as a maintenance switch). Flip back to Live when fixed.
