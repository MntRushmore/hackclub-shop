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
import { getStripe, isStripeConfigured } from './stripe';
import {
    CATALOG_MANAGED_FLAG,
    fromStripePrice,
    parseProductConfig,
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
