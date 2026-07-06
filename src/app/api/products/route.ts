import { NextResponse } from 'next/server';
import { getCatalogProducts } from '../../../lib/catalog';
import { getVariantStocks } from '../../../lib/inventory';

export async function GET() {
  try {
    // Stripe is the source of truth for the catalog; getCatalogProducts reads the
    // Stripe-fed projection (cache, with a live-Stripe fallback). Draft products
    // (e.g. created from an accepted sourcing quote) are never surfaced for sale.
    const rawProducts = (await getCatalogProducts()).filter((p) => !p.draft);

    // Enrich variants with live availability in one batched stock read. `available`
    // is null for untracked variants (unlimited) and a number when stock is tracked.
    const variantIds = rawProducts.flatMap((p) =>
        (p.variants || []).map((v, idx) => v.variant_id || v.id || `${p.id}_var_${idx}`),
    );
    const stocks = await getVariantStocks(variantIds);

    const products = rawProducts.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description || '',
        thumbnail_url: product.thumbnail_url,
        category: product.category || null,
        createdAt: product.createdAt || null,
        // Donation tiers: tier name + impact statement + gift FMV so the
        // storefront can render the ladder and the "~$X tax-deductible" line.
        donation: product.donation || null,
        sync_variants: (product.variants || []).map((variant, idx) => {
            const variantId = variant.variant_id || variant.id || `${product.id}_var_${idx}`;
            const available = stocks[variantId]?.available ?? null;
            return {
                id: variant.id || `${product.id}_var_${idx}`,
                variant_id: variantId,
                name: variant.name,
                retail_price: (variant.price ?? 0).toString(),
                // Catalog variants already carry resolved dual pricing.
                ...(variant.price_cash !== undefined ? { price_cash: variant.price_cash } : {}),
                ...(variant.price_points !== undefined ? { price_points: variant.price_points } : {}),
                size: variant.size || 'One Size',
                color: variant.color || 'Default',
                available, // null = unlimited; number = units left
                product: {
                    image: variant.image_url || product.image_url || product.thumbnail_url,
                },
            };
        }),
    }));

    return NextResponse.json({ code: 200, result: products });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ code: 500, message: 'Failed to load products' }, { status: 500 });
  }
}
