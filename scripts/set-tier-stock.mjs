// Set per-variant stock on the seeded donation tiers, in BOTH places stock
// lives: the Stripe Price metadata `stock` (catalog display) AND the inventory
// Redis cache `inventory:{variantId}` that reserve()/checkout actually enforce
// (see src/lib/inventory.ts — that cache is normally seeded by the admin
// receiving flow, which these tiers never went through). Without the Redis
// write the tiers sell as UNLIMITED and the 100-vest cap is not enforced.
//
// Companion to seed-donation-tiers.mjs. Idempotent: sets stock to exactly the
// numbers below, so re-running overwrites (it does NOT add) — do not re-run
// after sales start without accounting for units already sold.
//
// THE SPLIT (edit before running if your size curve differs):
//   Physical inventory from the wholesale order: 100 of each garment, 250
//   sticker packs, 100 mugs, 100 totes, 100 caps. The 100 vests are shared by
//   TWO tiers (Philanthropist + Founder's Circle both ship one), so they're
//   split 80/20 here. Apparel uses a standard 15/25/30/20/10 S-2XL curve.
//
// Usage:
//   node scripts/set-tier-stock.mjs --dry-run   # print the plan, touch nothing
//   node scripts/set-tier-stock.mjs             # write stock to Stripe

import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { readFileSync } from 'node:fs';

if (!process.env.STRIPE_SECRET_KEY) {
    try {
        for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env.local */ }
}

const DRY_RUN = process.argv.includes('--dry-run');

// Apparel curve helper: total × S/M/L/XL/2XL percentages, remainder into M.
function curve(total) {
    const s = Math.round(total * 0.15);
    const l = Math.round(total * 0.30);
    const xl = Math.round(total * 0.20);
    const xxl = Math.round(total * 0.10);
    const m = total - s - l - xl - xxl;
    return { S: s, M: m, L: l, XL: xl, '2XL': xxl };
}

const vestPhil = curve(80);      // Philanthropist's share of the 100 vests
const vestFounders = curve(20);  // Founder's Circle's share
const tees = curve(100);
const college = curve(100);
const mom = curve(100);

// variant_id (as minted by the seed script) -> stock
const STOCK = {
    'donation-tier-supporter-stickers': 250,
    'donation-tier-friend-mug': 100,
    'donation-tier-friend-tote': 100,
    'donation-tier-champion-cap': 100,
    ...Object.fromEntries(Object.entries(tees).map(([sz, n]) => [`donation-tier-champion-tee-${sz.toLowerCase()}`, n])),
    ...Object.fromEntries(Object.entries(college).map(([sz, n]) => [`donation-tier-patron-college-${sz.toLowerCase()}`, n])),
    ...Object.fromEntries(Object.entries(mom).map(([sz, n]) => [`donation-tier-patron-mom-${sz.toLowerCase()}`, n])),
    ...Object.fromEntries(Object.entries(vestPhil).map(([sz, n]) => [`donation-tier-philanthropist-vest-${sz.toLowerCase()}`, n])),
    ...Object.fromEntries(Object.entries(vestFounders).map(([sz, n]) => [`donation-tier-founders-circle-kit-vest-${sz.toLowerCase()}`, n])),
};

async function main() {
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY is not set (env or .env.local)');
        process.exit(1);
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Sanity: the two vest pools must total exactly 100.
    const vestTotal = [...Object.values(vestPhil), ...Object.values(vestFounders)].reduce((a, b) => a + b, 0);
    if (vestTotal !== 100) throw new Error(`Vest split totals ${vestTotal}, expected 100`);

    // Resolve every managed donation-tier Price by variant_id metadata.
    const prices = new Map(); // variant_id -> price
    for await (const price of stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] })) {
        const vid = price.metadata?.variant_id;
        if (vid && vid.startsWith('donation-tier-')) prices.set(vid, price);
    }

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error('UPSTASH_REDIS_REST_URL / _TOKEN not set — cannot write the inventory cache checkout enforces.');
        process.exit(1);
    }
    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    let updated = 0;
    const missing = [];
    for (const [vid, stock] of Object.entries(STOCK)) {
        const price = prices.get(vid);
        if (!price) { missing.push(vid); continue; }
        const current = price.metadata?.stock ?? '(unset)';
        const inv = await redis.get(`inventory:${vid}`);
        console.log(`${DRY_RUN ? '[dry-run] ' : ''}${vid}: stripe ${current} -> ${stock}, inventory ${inv ? JSON.stringify(inv.stock ?? inv) : '(unset)'} -> ${stock}`);
        if (!DRY_RUN) {
            await stripe.prices.update(price.id, { metadata: { stock: String(stock) } });
            // Same shape setStock() in src/lib/inventory.ts writes.
            await redis.set(`inventory:${vid}`, { stock, syncedAt: new Date().toISOString() });
            updated++;
        }
    }

    const extra = [...prices.keys()].filter((vid) => !(vid in STOCK));
    if (missing.length) console.warn(`\nWARNING: no Stripe Price found for: ${missing.join(', ')}`);
    if (extra.length) console.warn(`WARNING: tier variants in Stripe with no stock entry here (left untouched): ${extra.join(', ')}`);

    if (!DRY_RUN) {
        console.log(`\nDone: ${updated} prices updated.`);
        console.log('Each update fires a price.updated webhook that refreshes the storefront cache.');
        console.log('If the webhook is not subscribed to price.* events, trigger a catalog sync from /admin instead.');
    }
}

main().catch(err => { console.error(err); process.exit(1); });
