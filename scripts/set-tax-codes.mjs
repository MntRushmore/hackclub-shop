/**
 * Stamp Stripe Tax codes onto the managed catalog, in BOTH accounts:
 *
 *  - Apparel variants (tees, sweatshirts, vests, caps) get Price metadata
 *    `tax_code` = txcd_30011000 (Clothing & footwear) — tax-exempt in Vermont,
 *    where the shop is registered. Checkout reads this via the catalog
 *    projection and classifies the line (or the gift-FMV split) accordingly.
 *  - Clothing-only PRODUCTS (the retail t-shirt) also get the product-level
 *    tax_code, because retail lines billed by Price id inherit the Product's
 *    code, not price_data.
 *  - Everything else (stickers, mugs, totes) stays on the general
 *    tangible-goods code — correctly taxable.
 *
 * Idempotent; safe to re-run. Usage:
 *   node scripts/set-tax-codes.mjs --dry-run
 *   node scripts/set-tax-codes.mjs
 *
 * Keys from .env.local: STRIPE_SECRET_KEY (test) and STRIPE_LIVE_KEY (live).
 */

import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

const CLOTHING = 'txcd_30011000';
const MANAGED = 'hackclub_shop';
const DRY_RUN = process.argv.includes('--dry-run');

// A variant is apparel if its variant_id or display name says so. Matches the
// seed data: tee-*, college-*, mom-*, vest-* (incl. kit-vest-*), cap, and the
// retail t-shirt variants (var_tshirt_*). Totes/mugs/stickers never match.
const isApparel = (variantId = '', name = '') =>
    /(^|[-_])(tee|tshirt|college|mom|vest|cap)([-_]|$)/i.test(variantId)
    || /t-shirt|sweatshirt|vest|hoodie|\bcap\b/i.test(name);

// Products whose EVERY variant is clothing get the product-level code too.
const CLOTHING_ONLY_PRODUCTS = new Set(['prod_seed_tshirt']);

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

async function run(label, key) {
    if (!key) { console.log(`${label}: no key, skipping`); return; }
    const stripe = new Stripe(key);
    let pricesStamped = 0, pricesOk = 0, productsStamped = 0;

    for await (const product of stripe.products.list({ limit: 100 })) {
        if (product.metadata?.managed_by !== MANAGED) continue;
        const shopId = product.metadata.shop_product_id || product.id;

        if (CLOTHING_ONLY_PRODUCTS.has(shopId)) {
            const current = typeof product.tax_code === 'string' ? product.tax_code : product.tax_code?.id;
            if (current !== CLOTHING) {
                console.log(`${label}: product ${shopId} -> clothing tax code`);
                productsStamped++;
                if (!DRY_RUN) await stripe.products.update(product.id, { tax_code: CLOTHING });
            }
        }

        for await (const price of stripe.prices.list({ product: product.id, limit: 100 })) {
            if (!price.active || price.metadata?.managed_by !== MANAGED) continue;
            const vid = price.metadata.variant_id || price.id;
            if (!isApparel(vid, price.metadata.name)) continue;
            if (price.metadata.tax_code === CLOTHING) { pricesOk++; continue; }
            console.log(`${label}: price ${vid} -> clothing tax code`);
            pricesStamped++;
            if (!DRY_RUN) {
                await stripe.prices.update(price.id, {
                    metadata: { ...price.metadata, tax_code: CLOTHING },
                });
            }
        }
    }
    console.log(`${label}: ${pricesStamped} prices stamped, ${pricesOk} already correct, ${productsStamped} products updated${DRY_RUN ? ' (dry run)' : ''}`);
}

await run('TEST', env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? env.STRIPE_SECRET_KEY : undefined);
await run('LIVE', env.STRIPE_LIVE_KEY);
