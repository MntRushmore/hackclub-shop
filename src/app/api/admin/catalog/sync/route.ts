import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import Stripe from 'stripe';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { getStripe, isStripeConfigured } from '../../../../../lib/stripe';
import { Product } from '../../../../../types/Admin';
import {
    toStripeProduct,
    toStripePrice,
    variantKey,
    CATALOG_MANAGED_FLAG,
} from '../../../../../lib/catalogMapping';
import { rebuildCatalogCache } from '../../../../../lib/catalog';

/**
 * Migrate the Redis product catalog into Stripe (Products + Prices), then rebuild
 * the read-side cache projection. This is the Phase-1 migration entry point —
 * after Stripe is the source of truth, staff edit in the Stripe Dashboard and the
 * webhook keeps the cache current; this route exists to seed Stripe from the
 * existing Redis catalog and to do an on-demand full re-sync.
 *
 * GET  → DRY RUN. Reads every Redis product, computes the exact Stripe payload
 *        for each, and reports what WOULD be created/updated. Touches nothing.
 *        Use this to verify the field mapping against real data first.
 * POST  → APPLY. Idempotently upserts each Redis product into Stripe (matched by
 *        Product.metadata.shop_product_id so a re-run updates rather than dupes),
 *        upserts one Price per variant, archives Prices for removed variants, and
 *        rebuilds the cache. Gated on canManageProducts.
 *
 * Idempotency: Stripe Products are immutable-id but we look up the existing one by
 * shop_product_id before creating. Stripe Prices are immutable (unit_amount can't
 * change once set), so a changed cash price means: create a new Price, archive the
 * old one. We match a variant's current Price by metadata.variant_id.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const STRIPE_METADATA_VALUE_MAX = 500;

async function loadRedisProducts(): Promise<Product[]> {
    const keys = await redis.keys('product:*');
    const products: Product[] = [];
    for (const key of keys) {
        const p = await redis.get<Product>(key);
        if (p) products.push(p);
    }
    return products;
}

/** Find the existing managed Stripe Product for a shop product id, if any. */
async function findStripeProduct(stripe: Stripe, shopProductId: string): Promise<Stripe.Product | null> {
    const res = await stripe.products.search({
        query: `metadata['shop_product_id']:'${shopProductId}' AND metadata['managed_by']:'${CATALOG_MANAGED_FLAG}'`,
        limit: 1,
    });
    return res.data[0] || null;
}

/** Active Prices for a Stripe product, keyed by their variant_id metadata. */
async function activePricesByVariant(stripe: Stripe, productId: string): Promise<Map<string, Stripe.Price>> {
    const map = new Map<string, Stripe.Price>();
    for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
        const vid = price.metadata?.variant_id;
        if (vid) map.set(vid, price);
    }
    return map;
}

interface PlanWarning {
    productId: string;
    field: string;
    message: string;
}

/** Build the dry-run plan: what each product maps to, plus any mapping warnings. */
function planFor(products: Product[]): {
    plan: Array<{
        shopProductId: string;
        name: string;
        draft: boolean;
        variants: Array<{
            variantId: string;
            name: string;
            unitAmount: number;
            isCashBuyable: boolean;
            pricePoints?: string;
            stock?: string;
            sku?: string;
        }>;
    }>;
    warnings: PlanWarning[];
} {
    const warnings: PlanWarning[] = [];
    const plan = products.map((product) => {
        const sp = toStripeProduct(product);
        if (sp.metadata.config.length > STRIPE_METADATA_VALUE_MAX) {
            warnings.push({
                productId: product.id,
                field: 'config',
                message: `Product config JSON is ${sp.metadata.config.length} chars (Stripe caps a metadata value at ${STRIPE_METADATA_VALUE_MAX}). Shipping options / checkout fields may be truncated — review before applying.`,
            });
        }
        const variants = (product.variants || []).map((v) => {
            const price = toStripePrice(v);
            if (!price.isCashBuyable && !price.metadata.price_points) {
                warnings.push({
                    productId: product.id,
                    field: variantKey(v),
                    message: `Variant "${v.name}" has neither a cash nor a points price — it will be imported as unbuyable.`,
                });
            }
            return {
                variantId: variantKey(v),
                name: v.name,
                unitAmount: price.unitAmount,
                isCashBuyable: price.isCashBuyable,
                pricePoints: price.metadata.price_points,
                stock: price.metadata.stock,
                sku: price.metadata.sku,
            };
        });
        return {
            shopProductId: product.id,
            name: product.name,
            draft: Boolean(product.draft),
            variants,
        };
    });
    return { plan, warnings };
}

export async function GET() {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');
    if (!canManage.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured (STRIPE_SECRET_KEY missing)' }, { status: 400 });

    try {
        const products = await loadRedisProducts();
        const { plan, warnings } = planFor(products);
        return NextResponse.json({
            dryRun: true,
            productCount: products.length,
            variantCount: plan.reduce((n, p) => n + p.variants.length, 0),
            warnings,
            plan,
        });
    } catch (error) {
        console.error('[catalog/sync] dry run failed:', error);
        return NextResponse.json({ error: 'Dry run failed' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');
    if (!canManage.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured (STRIPE_SECRET_KEY missing)' }, { status: 400 });

    // Require an explicit confirm flag so a stray POST can't mutate the live Stripe
    // catalog. The dry-run GET is the safe default for inspection.
    let body: { confirm?: boolean } = {};
    try {
        body = await request.json();
    } catch {
        /* empty body is fine; confirm stays false */
    }
    if (!body.confirm) {
        return NextResponse.json(
            { error: 'Refusing to apply without { "confirm": true }. GET this endpoint first for a dry run.' },
            { status: 400 },
        );
    }

    const stripe = getStripe();
    const results: Array<{ shopProductId: string; stripeProductId: string; action: 'created' | 'updated'; pricesCreated: number; pricesArchived: number }> = [];
    const errors: Array<{ shopProductId: string; error: string }> = [];

    try {
        const products = await loadRedisProducts();

        for (const product of products) {
            try {
                const sp = toStripeProduct(product);

                // Upsert the Product (match by shop_product_id; create otherwise).
                let stripeProduct = await findStripeProduct(stripe, product.id);
                let action: 'created' | 'updated';
                if (stripeProduct) {
                    stripeProduct = await stripe.products.update(stripeProduct.id, {
                        name: sp.name,
                        description: sp.description,
                        images: sp.images,
                        tax_code: sp.tax_code,
                        metadata: sp.metadata,
                        active: true,
                    });
                    action = 'updated';
                } else {
                    stripeProduct = await stripe.products.create({
                        name: sp.name,
                        description: sp.description,
                        images: sp.images,
                        tax_code: sp.tax_code,
                        metadata: sp.metadata,
                    });
                    action = 'created';
                }

                // Upsert one Price per variant. Stripe Prices are immutable, so we
                // only create a new Price when the variant has no active Price or its
                // amount changed; the old Price for that variant is then archived.
                const existing = await activePricesByVariant(stripe, stripeProduct.id);
                const keptPriceIds = new Set<string>();
                let pricesCreated = 0;

                for (const variant of product.variants || []) {
                    const vid = variantKey(variant);
                    const desired = toStripePrice(variant);
                    const current = existing.get(vid);

                    const sameAmount = current && (current.unit_amount ?? 0) === desired.unitAmount;
                    if (current && sameAmount) {
                        // Amount unchanged — just refresh the metadata in place
                        // (points/stock/sku can change without a new Price).
                        await stripe.prices.update(current.id, {
                            metadata: { ...desired.metadata, is_cash_buyable: desired.isCashBuyable ? '1' : '0' },
                        });
                        keptPriceIds.add(current.id);
                    } else {
                        const created = await stripe.prices.create({
                            product: stripeProduct.id,
                            currency: 'usd',
                            unit_amount: desired.unitAmount,
                            tax_behavior: 'exclusive',
                            metadata: { ...desired.metadata, is_cash_buyable: desired.isCashBuyable ? '1' : '0' },
                        });
                        keptPriceIds.add(created.id);
                        pricesCreated++;
                    }
                }

                // Archive any previously-active managed Prices we didn't keep — these
                // are variants that were removed or whose amount changed.
                let pricesArchived = 0;
                for (const price of existing.values()) {
                    if (!keptPriceIds.has(price.id)) {
                        await stripe.prices.update(price.id, { active: false });
                        pricesArchived++;
                    }
                }

                results.push({ shopProductId: product.id, stripeProductId: stripeProduct.id, action, pricesCreated, pricesArchived });
            } catch (err) {
                console.error(`[catalog/sync] product ${product.id} failed:`, err);
                errors.push({ shopProductId: product.id, error: err instanceof Error ? err.message : String(err) });
            }
        }

        // Rebuild the read projection from Stripe so the storefront/checkout reflect
        // the freshly-imported catalog immediately.
        const cache = await rebuildCatalogCache();

        return NextResponse.json({
            applied: true,
            imported: results.length,
            failed: errors.length,
            cached: cache.count,
            results,
            errors,
        });
    } catch (error) {
        console.error('[catalog/sync] apply failed:', error);
        return NextResponse.json({ error: 'Apply failed', errors }, { status: 500 });
    }
}
