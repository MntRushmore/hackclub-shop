/**
 * Copy the shop-managed Stripe catalog (products + variant prices) between the
 * LIVE and TEST accounts, preserving the metadata contract from
 * src/lib/catalogMapping.ts (shop_product_id, variant_id, config JSON, price
 * metadata, tax codes).
 *
 * Directions:
 *   default    : LIVE -> TEST  (mirror the real store into test mode)
 *   --to-live  : TEST -> LIVE  (seed the live account before launch).
 *                Requires --confirm-live as well — this writes to the real store.
 *
 * Usage:
 *   node scripts/copy-catalog-to-test.mjs --dry-run              # preview live -> test
 *   node scripts/copy-catalog-to-test.mjs                        # copy live -> test
 *   node scripts/copy-catalog-to-test.mjs --to-live --dry-run    # preview test -> live
 *   node scripts/copy-catalog-to-test.mjs --to-live --confirm-live
 *
 * Keys (environment or .env.local):
 *   STRIPE_LIVE_KEY  — the live-mode key (sk_live_/rk_live_). For live -> test
 *                      a read-only restricted key is enough.
 *   STRIPE_TEST_KEY  — the test-mode key; falls back to STRIPE_SECRET_KEY from
 *                      .env.local when that is an sk_test_ key.
 *
 * Idempotent both ways: destination products are matched by
 * metadata.shop_product_id and updated in place; prices are matched by
 * metadata.variant_id — an amount change deactivates the old price and creates
 * a new one (Stripe prices are immutable). Managed destination products/prices
 * with no source counterpart are archived. Safe to re-run any time.
 *
 * NOTE: inventory is NOT copied here because it doesn't live in Stripe — stock
 * counts live in Redis keyed by variant_id, which survives the copy unchanged.
 * After seeding LIVE and pointing production's STRIPE_SECRET_KEY at it, rebuild
 * the catalog cache (POST /api/admin/catalog/rebuild) so the storefront stops
 * projecting test-account price ids.
 */

import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MANAGED_FLAG = 'hackclub_shop';
const DRY_RUN = process.argv.includes('--dry-run');
const TO_LIVE = process.argv.includes('--to-live');
const CONFIRM_LIVE = process.argv.includes('--confirm-live');

// --- resolve keys ------------------------------------------------------------
function loadEnvLocal() {
    try {
        const root = join(dirname(fileURLToPath(import.meta.url)), '..');
        const raw = readFileSync(join(root, '.env.local'), 'utf8');
        const out = {};
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
        return out;
    } catch {
        return {};
    }
}

const envLocal = loadEnvLocal();
const liveKey = process.env.STRIPE_LIVE_KEY || envLocal.STRIPE_LIVE_KEY;
const testKey =
    process.env.STRIPE_TEST_KEY
    || envLocal.STRIPE_TEST_KEY
    || (envLocal.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? envLocal.STRIPE_SECRET_KEY : undefined);

if (!liveKey) {
    console.error('Missing STRIPE_LIVE_KEY (set it in the environment or add a STRIPE_LIVE_KEY=... line to .env.local).');
    process.exit(1);
}
if (!testKey) {
    console.error('Missing STRIPE_TEST_KEY and no sk_test_ STRIPE_SECRET_KEY in .env.local.');
    process.exit(1);
}
if (!/^(sk|rk)_live_/.test(liveKey)) {
    console.error('STRIPE_LIVE_KEY is not a live-mode key (expected sk_live_/rk_live_).');
    process.exit(1);
}
if (!/^(sk|rk)_test_/.test(testKey)) {
    console.error('Test key is not a test-mode key (expected sk_test_/rk_test_).');
    process.exit(1);
}
if (TO_LIVE && !CONFIRM_LIVE && !DRY_RUN) {
    console.error('Refusing to write to the LIVE account without --confirm-live (or use --dry-run to preview).');
    process.exit(1);
}

const src = new Stripe(TO_LIVE ? testKey : liveKey);
const dst = new Stripe(TO_LIVE ? liveKey : testKey);
const direction = TO_LIVE ? 'TEST -> LIVE' : 'LIVE -> TEST';

// --- helpers ------------------------------------------------------------------
async function listManagedProducts(client) {
    const products = [];
    for await (const p of client.products.list({ limit: 100 })) {
        if (p.metadata?.managed_by === MANAGED_FLAG) products.push(p);
    }
    return products;
}

async function listPrices(client, productId) {
    const prices = [];
    for await (const pr of client.prices.list({ product: productId, limit: 100 })) {
        prices.push(pr);
    }
    return prices;
}

const productPayload = (p) => ({
    name: p.name,
    description: p.description || undefined,
    images: (p.images || []).slice(0, 8),
    ...(p.tax_code ? { tax_code: typeof p.tax_code === 'string' ? p.tax_code : p.tax_code.id } : {}),
    active: p.active,
    metadata: p.metadata,
});

const pricePayload = (pr, destProductId) => ({
    product: destProductId,
    currency: pr.currency,
    unit_amount: pr.unit_amount ?? 0,
    ...(pr.recurring ? { recurring: { interval: pr.recurring.interval, interval_count: pr.recurring.interval_count } } : {}),
    ...(pr.tax_behavior && pr.tax_behavior !== 'unspecified' ? { tax_behavior: pr.tax_behavior } : {}),
    ...(pr.nickname ? { nickname: pr.nickname } : {}),
    metadata: pr.metadata,
});

const sameMetadata = (a = {}, b = {}) => {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

// --- main ---------------------------------------------------------------------
const [srcProducts, dstProducts] = await Promise.all([
    listManagedProducts(src),
    listManagedProducts(dst),
]);
console.log(`${direction}${DRY_RUN ? ' (dry run)' : ''}`);
console.log(`Source: ${srcProducts.length} managed products. Destination: ${dstProducts.length} managed products.`);

const dstByShopId = new Map(dstProducts.map((p) => [p.metadata.shop_product_id || p.id, p]));
const stats = { productsCreated: 0, productsUpdated: 0, pricesCreated: 0, pricesDeactivated: 0, pricesUnchanged: 0, productsArchived: 0 };

for (const source of srcProducts) {
    const shopId = source.metadata.shop_product_id || source.id;
    let dest = dstByShopId.get(shopId);

    if (!dest) {
        console.log(`+ product ${shopId} (${source.name})`);
        stats.productsCreated++;
        if (!DRY_RUN) dest = await dst.products.create(productPayload(source));
    } else {
        console.log(`~ product ${shopId} (${source.name})`);
        stats.productsUpdated++;
        if (!DRY_RUN) dest = await dst.products.update(dest.id, productPayload(source));
        dstByShopId.delete(shopId); // consumed — leftovers get archived below
    }
    if (DRY_RUN && !dest) continue;

    const [srcPrices, dstPrices] = await Promise.all([
        listPrices(src, source.id),
        dest ? listPrices(dst, dest.id) : [],
    ]);
    const dstByVariant = new Map(
        dstPrices.filter((pr) => pr.active).map((pr) => [pr.metadata?.variant_id || pr.id, pr]),
    );

    for (const pr of srcPrices.filter((p) => p.active && p.metadata?.managed_by === MANAGED_FLAG)) {
        const variantId = pr.metadata.variant_id || pr.id;
        const existing = dstByVariant.get(variantId);
        dstByVariant.delete(variantId);

        if (existing && existing.unit_amount === pr.unit_amount && existing.currency === pr.currency
            && sameMetadata(existing.metadata, pr.metadata)) {
            stats.pricesUnchanged++;
            continue;
        }
        if (existing) {
            console.log(`  ~ price ${variantId}: ${existing.unit_amount} -> ${pr.unit_amount} (recreate)`);
            stats.pricesDeactivated++;
            if (!DRY_RUN) await dst.prices.update(existing.id, { active: false });
        } else {
            console.log(`  + price ${variantId} (${pr.unit_amount ?? 0} ${pr.currency})`);
        }
        stats.pricesCreated++;
        if (!DRY_RUN) await dst.prices.create(pricePayload(pr, dest.id));
    }

    // Active managed destination prices whose variant no longer exists in source.
    for (const [variantId, orphan] of dstByVariant) {
        if (orphan.metadata?.managed_by !== MANAGED_FLAG) continue;
        console.log(`  - price ${variantId} (gone from source, deactivating)`);
        stats.pricesDeactivated++;
        if (!DRY_RUN) await dst.prices.update(orphan.id, { active: false });
    }
}

// Managed destination products with no source counterpart anymore.
for (const [shopId, orphan] of dstByShopId) {
    if (!orphan.active) continue;
    console.log(`- product ${shopId} (gone from source, archiving)`);
    stats.productsArchived++;
    if (!DRY_RUN) await dst.products.update(orphan.id, { active: false });
}

console.log('\nDone.', JSON.stringify(stats));
if (DRY_RUN) console.log('Dry run — nothing was written.');
