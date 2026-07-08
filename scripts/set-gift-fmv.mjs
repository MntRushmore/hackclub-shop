/**
 * Stamp each donation-tier gift's declared fair market value (Price metadata
 * `fmv_cents`) into BOTH Stripe accounts. With per-gift FMVs present, checkout
 * bills each chosen gift as its own line — own declared value, own tax code —
 * instead of one combined tier-level FMV line.
 *
 * Values mirror scripts/seed-donation-tiers.mjs (derived from the tier-level
 * FMV declarations: each tier's FMV = its highest-value gift):
 *   stickers $5 · mug $30 · tote $30 · tee $35 · cap $35 ·
 *   sweatshirts $80 · vest $100
 *
 * Idempotent; safe to re-run. Usage:
 *   node scripts/set-gift-fmv.mjs --dry-run
 *   node scripts/set-gift-fmv.mjs
 */

import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

const MANAGED = 'hackclub_shop';
const DRY_RUN = process.argv.includes('--dry-run');

// variant_id pattern -> declared FMV in cents. First match wins; order matters
// (kit-vest before generic patterns is unnecessary since 'vest' matches both).
const FMV_RULES = [
    [/(^|-)stickers($|-)/, 500],
    [/(^|-)mug($|-)/, 3000],
    [/(^|-)tote($|-)/, 3000],
    [/(^|-)cap($|-)/, 3500],
    [/(^|-)tee-/, 3500],
    [/(^|-)college-/, 8000],
    [/(^|-)mom-/, 8000],
    [/vest-/, 10000],
];

const fmvFor = (variantId = '') => {
    for (const [re, cents] of FMV_RULES) if (re.test(variantId)) return cents;
    return null;
};

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

async function run(label, key) {
    if (!key) { console.log(`${label}: no key, skipping`); return; }
    const stripe = new Stripe(key);
    let stamped = 0, ok = 0, skipped = 0;

    for await (const product of stripe.products.list({ limit: 100 })) {
        if (product.metadata?.managed_by !== MANAGED) continue;
        // Only donation tiers carry gift FMVs.
        if (!(product.metadata.shop_product_id || '').startsWith('donation-tier-')) continue;

        for await (const price of stripe.prices.list({ product: product.id, limit: 100 })) {
            if (!price.active || price.metadata?.managed_by !== MANAGED) continue;
            const vid = price.metadata.variant_id || price.id;
            const cents = fmvFor(vid);
            if (cents === null) { console.log(`${label}: NO RULE for ${vid} — skipped`); skipped++; continue; }
            if (price.metadata.fmv_cents === String(cents)) { ok++; continue; }
            console.log(`${label}: ${vid} -> fmv_cents ${cents}`);
            stamped++;
            if (!DRY_RUN) {
                await stripe.prices.update(price.id, {
                    metadata: { ...price.metadata, fmv_cents: String(cents) },
                });
            }
        }
    }
    console.log(`${label}: ${stamped} stamped, ${ok} already correct, ${skipped} unmatched${DRY_RUN ? ' (dry run)' : ''}`);
}

await run('TEST', env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? env.STRIPE_SECRET_KEY : undefined);
await run('LIVE', env.STRIPE_LIVE_KEY);
