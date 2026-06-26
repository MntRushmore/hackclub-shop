/**
 * Catalog read layer — Stripe is the source of truth, this is the fast read-side
 * projection the storefront, checkout validation, and finance read from.
 *
 * Stripe is canonical for products/prices/stock/sku/points/cost. We keep a Redis
 * projection (`catalog:product:{shopProductId}`) so storefront reads don't hit the
 * Stripe API on every page load and so a Stripe outage degrades to a slightly
 * stale catalog rather than an empty store. The projection is rebuilt:
 *   - in bulk by the import/sync route (POST /api/admin/catalog/sync), and
 *   - incrementally by the Stripe `product.*` / `price.*` webhooks.
 *
 * Reads here are fire-and-forget safe: a cache miss or Redis hiccup falls back to
 * reading Stripe directly (`fetchCatalogFromStripe`) so the store still works
 * before the first sync runs. Nothing here writes to Stripe.
 */

import { Redis } from '@upstash/redis';
import type { Product } from '../types/Admin';
import { getStripe, isStripeConfigured } from './stripe';
import {
    CATALOG_MANAGED_FLAG,
    fromStripePrice,
    parseProductConfig,
    toStripeProduct,
    toStripePrice,
    variantKey,
    type CatalogProduct,
    type CatalogVariant,
} from './catalogMapping';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const cacheKey = (shopProductId: string) => `catalog:product:${shopProductId}`;
const CACHE_INDEX = 'catalog:index'; // set of shop product ids that have a cache entry

export type { CatalogProduct, CatalogVariant };

// ---------------------------------------------------------------------------
// Building the projection from Stripe
// ---------------------------------------------------------------------------

/**
 * Assemble a single CatalogProduct from a Stripe Product and its active Prices.
 * The shop product id is read back from Product.metadata.shop_product_id (set at
 * import) so existing ids — and every join key already stored on orders, the
 * inventory cache, and the sku index — keep working unchanged.
 */
export function buildCatalogProduct(
    stripeProduct: {
        id: string;
        name: string;
        description: string | null;
        created?: number; // Stripe Product created (unix seconds)
        metadata: Record<string, string>;
    },
    prices: Array<{ id: string; unit_amount: number | null; active: boolean; metadata: Record<string, string> }>,
): CatalogProduct {
    const config = parseProductConfig(stripeProduct.metadata.config);
    const shopProductId = stripeProduct.metadata.shop_product_id || stripeProduct.id;

    const variants: CatalogVariant[] = prices
        .filter((p) => p.active)
        .map((p) => fromStripePrice(p));

    return {
        id: shopProductId,
        name: stripeProduct.name,
        description: stripeProduct.description || '',
        image_url: config.image_url,
        thumbnail_url: config.thumbnail_url,
        category: config.category,
        variants,
        shippingOptions: config.shippingOptions || [],
        checkoutFields: config.checkoutFields || [],
        draft: config.draft,
        createdAt: typeof stripeProduct.created === 'number'
            ? new Date(stripeProduct.created * 1000).toISOString()
            : undefined,
        stripeProductId: stripeProduct.id,
    };
}

/**
 * Pull the entire managed catalog straight from Stripe (no cache). Used by the
 * bulk sync and as the fallback when the Redis projection is cold. Lists all
 * active products, then each product's active prices, and assembles them.
 */
export async function fetchCatalogFromStripe(): Promise<CatalogProduct[]> {
    if (!isStripeConfigured()) return [];
    const stripe = getStripe();
    const products: CatalogProduct[] = [];

    for await (const product of stripe.products.list({ active: true, limit: 100 })) {
        // Only project products this shop manages — leave any hand-made Stripe
        // products (one-off invoices, etc.) out of the storefront.
        if (product.metadata?.managed_by !== CATALOG_MANAGED_FLAG) continue;

        const prices: Array<{ id: string; unit_amount: number | null; active: boolean; metadata: Record<string, string> }> = [];
        for await (const price of stripe.prices.list({ product: product.id, limit: 100 })) {
            prices.push({
                id: price.id,
                unit_amount: price.unit_amount,
                active: price.active,
                metadata: price.metadata || {},
            });
        }
        products.push(
            buildCatalogProduct(
                { id: product.id, name: product.name, description: product.description, created: product.created, metadata: product.metadata || {} },
                prices,
            ),
        );
    }
    return products;
}

// ---------------------------------------------------------------------------
// Cache writes (called by the sync route and the webhook)
// ---------------------------------------------------------------------------

/** Write one product into the Redis projection and track it in the index set. */
export async function putCatalogCache(product: CatalogProduct): Promise<void> {
    try {
        await redis.set(cacheKey(product.id), product);
        await redis.sadd(CACHE_INDEX, product.id);
    } catch (err) {
        console.error('[catalog] cache write failed:', err instanceof Error ? err.message : err);
    }
}

/** Remove a product from the projection (Stripe product deleted/archived). */
export async function dropCatalogCache(shopProductId: string): Promise<void> {
    try {
        await redis.del(cacheKey(shopProductId));
        await redis.srem(CACHE_INDEX, shopProductId);
    } catch (err) {
        console.error('[catalog] cache drop failed:', err instanceof Error ? err.message : err);
    }
}

/** Rebuild the whole projection from Stripe. Returns the number of products cached. */
export async function rebuildCatalogCache(): Promise<{ count: number }> {
    const products = await fetchCatalogFromStripe();
    const seen = new Set(products.map((p) => p.id));
    for (const product of products) await putCatalogCache(product);

    // Drop any cache entries for products that no longer exist in Stripe.
    try {
        const indexed = await redis.smembers(CACHE_INDEX);
        for (const id of indexed) {
            if (!seen.has(id)) await dropCatalogCache(id);
        }
    } catch (err) {
        console.error('[catalog] stale prune failed:', err instanceof Error ? err.message : err);
    }
    return { count: products.length };
}

// ---------------------------------------------------------------------------
// Reads (storefront, checkout, finance)
// ---------------------------------------------------------------------------

/**
 * All products. Reads the Redis projection; if it's empty (no sync yet) falls
 * back to a live Stripe read so the store is never blank before the first sync.
 */
export async function getCatalogProducts(): Promise<CatalogProduct[]> {
    try {
        const ids = await redis.smembers(CACHE_INDEX);
        if (ids.length > 0) {
            const entries = await Promise.all(ids.map((id) => redis.get<CatalogProduct>(cacheKey(id))));
            const products = entries.filter((p): p is CatalogProduct => Boolean(p));
            if (products.length > 0) return products;
        }
    } catch (err) {
        console.error('[catalog] cache read failed, falling back to Stripe:', err instanceof Error ? err.message : err);
    }
    return fetchCatalogFromStripe();
}

/** A single product by its shop product id (cache, then Stripe fallback). */
export async function getCatalogProduct(shopProductId: string): Promise<CatalogProduct | null> {
    try {
        const cached = await redis.get<CatalogProduct>(cacheKey(shopProductId));
        if (cached) return cached;
    } catch (err) {
        console.error('[catalog] cache get failed:', err instanceof Error ? err.message : err);
    }
    const all = await fetchCatalogFromStripe();
    return all.find((p) => p.id === shopProductId) || null;
}

/** Resolve a single variant across all products by its canonical variant id. */
export async function getCatalogVariant(
    variantId: string,
): Promise<{ product: CatalogProduct; variant: CatalogVariant } | null> {
    const products = await getCatalogProducts();
    for (const product of products) {
        const variant = product.variants.find((v) => String(v.variant_id) === String(variantId));
        if (variant) return { product, variant };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Write-back: operational flows (receiving, SKU) update Stripe, not Redis
// ---------------------------------------------------------------------------

/**
 * Patch a variant's Stripe Price metadata in place and refresh the cache entry.
 * This is how the operational flows that USED to write the Redis product store
 * (stock receipt, SKU minting) persist now that Stripe is the source of truth:
 * stock / unitCost / sku / scanCode all live in Price.metadata.
 *
 * Resolves the Price by its variant_id (found via getCatalogVariant, which gives
 * us the stripePriceId). Only the provided keys are changed; others are left as-is.
 * Best-effort: a Stripe/Redis hiccup logs and returns false rather than throwing
 * into a caller — matching the fire-and-forget contract of inventory/costing.
 *
 * Numeric fields are stringified (Stripe metadata is string-valued); passing
 * `null` for a field deletes that metadata key (e.g. clearing a stock number to
 * make a variant untracked).
 */
export async function updateVariantStripeMetadata(
    variantId: string,
    patch: Partial<{ stock: number | null; unitCost: number | null; sku: string | null; scanCode: string | null }>,
): Promise<boolean> {
    if (!isStripeConfigured()) {
        console.error('[catalog] updateVariantStripeMetadata: Stripe not configured');
        return false;
    }
    try {
        const found = await getCatalogVariant(variantId);
        if (!found || !found.variant.stripePriceId) {
            console.error('[catalog] updateVariantStripeMetadata: no Stripe Price for variant', variantId);
            return false;
        }
        const priceId = found.variant.stripePriceId;

        // Stripe deletes a metadata key when its value is passed as empty string.
        const meta: Record<string, string> = {};
        const set = (key: string, value: number | string | null | undefined) => {
            if (value === undefined) return; // not part of this patch → leave untouched
            meta[key] = value === null ? '' : String(value);
        };
        set('stock', patch.stock);
        set('unit_cost', patch.unitCost);
        set('sku', patch.sku);
        set('scan_code', patch.scanCode);
        if (Object.keys(meta).length === 0) return true;

        const stripe = getStripe();
        await stripe.prices.update(priceId, { metadata: meta });

        // Reproject the owning product so the cache reflects the change immediately
        // (the price.updated webhook will also fire, but we don't want to wait on it).
        await refreshProductCacheById(found.product.stripeProductId);
        return true;
    } catch (err) {
        console.error('[catalog] updateVariantStripeMetadata failed:', err instanceof Error ? err.message : err);
        return false;
    }
}

/**
 * Create or update a single shop Product in Stripe (Product + one Price per
 * variant), then cache it. Idempotent: matches an existing Stripe Product by
 * shop_product_id, so re-accepting/re-running updates rather than duplicating.
 * Returns the resulting CatalogProduct, or null on failure.
 *
 * Used by flows that MINT a new catalog product (e.g. accepting a sourcing quote)
 * now that Stripe owns the catalog. Shares the same mapping as the bulk sync route.
 */
export async function upsertCatalogProduct(product: Product): Promise<CatalogProduct | null> {
    if (!isStripeConfigured()) {
        console.error('[catalog] upsertCatalogProduct: Stripe not configured');
        return null;
    }
    try {
        const stripe = getStripe();
        const sp = toStripeProduct(product);

        // Match an existing managed Stripe Product by shop_product_id.
        const search = await stripe.products.search({
            query: `metadata['shop_product_id']:'${product.id}' AND metadata['managed_by']:'${CATALOG_MANAGED_FLAG}'`,
            limit: 1,
        });
        let stripeProduct = search.data[0];
        if (stripeProduct) {
            stripeProduct = await stripe.products.update(stripeProduct.id, {
                name: sp.name, description: sp.description, images: sp.images, tax_code: sp.tax_code, metadata: sp.metadata, active: true,
            });
        } else {
            stripeProduct = await stripe.products.create({
                name: sp.name, description: sp.description, images: sp.images, tax_code: sp.tax_code, metadata: sp.metadata,
            });
        }

        // Active Prices keyed by variant_id, so a re-run reuses unchanged ones.
        const existing = new Map<string, string>(); // variant_id -> price id
        const amounts = new Map<string, number>();   // price id -> unit_amount
        for await (const price of stripe.prices.list({ product: stripeProduct.id, active: true, limit: 100 })) {
            if (price.metadata?.variant_id) { existing.set(price.metadata.variant_id, price.id); amounts.set(price.id, price.unit_amount ?? 0); }
        }
        const kept = new Set<string>();
        for (const variant of product.variants || []) {
            const vid = variantKey(variant);
            const desired = toStripePrice(variant);
            const meta = { ...desired.metadata, is_cash_buyable: desired.isCashBuyable ? '1' : '0' };
            const curId = existing.get(vid);
            if (curId && amounts.get(curId) === desired.unitAmount) {
                await stripe.prices.update(curId, { metadata: meta });
                kept.add(curId);
            } else {
                const created = await stripe.prices.create({ product: stripeProduct.id, currency: 'usd', unit_amount: desired.unitAmount, tax_behavior: 'exclusive', metadata: meta });
                kept.add(created.id);
            }
        }
        for (const priceId of existing.values()) {
            if (!kept.has(priceId)) await stripe.prices.update(priceId, { active: false });
        }

        await refreshProductCacheById(stripeProduct.id);
        return getCatalogProduct(product.id);
    } catch (err) {
        console.error('[catalog] upsertCatalogProduct failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

/** Reproject one Stripe product (by Stripe product id) into the cache. */
async function refreshProductCacheById(stripeProductId: string): Promise<void> {
    const stripe = getStripe();
    const product = await stripe.products.retrieve(stripeProductId);
    if (product.metadata?.managed_by !== CATALOG_MANAGED_FLAG) return;
    const prices: Array<{ id: string; unit_amount: number | null; active: boolean; metadata: Record<string, string> }> = [];
    for await (const price of stripe.prices.list({ product: stripeProductId, limit: 100 })) {
        prices.push({ id: price.id, unit_amount: price.unit_amount, active: price.active, metadata: price.metadata || {} });
    }
    await putCatalogCache(
        buildCatalogProduct(
            { id: product.id, name: product.name, description: product.description, created: product.created, metadata: product.metadata || {} },
            prices,
        ),
    );
}
