import { NextRequest, NextResponse } from 'next/server';
import { getVariantStocks } from '../../../../lib/inventory';
import { getCatalogProduct } from '../../../../lib/catalog';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const productId = params.id;

    try {
        // Stripe is the source of truth; read from the catalog projection.
        const product = await getCatalogProduct(productId);

        // Draft products (created from an accepted sourcing quote) aren't public —
        // 404 them on the storefront just like a missing product, even by direct URL.
        if (!product || product.draft) {
            return NextResponse.json({ message: 'Product not found' }, { status: 404 });
        }

        const result = {
            sync_product: {
                id: product.id,
                name: product.name,
                thumbnail_url: product.thumbnail_url,
                shippingOptions: product.shippingOptions || [],
                checkoutFields: product.checkoutFields || [],
            },
            sync_variants: (product.variants || []).map((variant, idx) => ({
                id: variant.id || `${product.id}_var_${idx}`,
                variant_id: variant.variant_id || `${product.id}_var_${idx}`,
                name: variant.name,
                retail_price: (variant.price ?? 0).toString(),
                // Catalog variants already carry resolved dual pricing.
                ...(variant.price_cash !== undefined ? { price_cash: variant.price_cash } : {}),
                ...(variant.price_points !== undefined ? { price_points: variant.price_points } : {}),
                size: variant.size || 'One Size',
                color: variant.color || 'Default',
                product: {
                    image: variant.image_url || product.image_url || product.thumbnail_url,
                },
            })),
        };

        // Enrich variants with live availability (null = untracked/unlimited).
        const stocks = await getVariantStocks(result.sync_variants.map((v: any) => v.variant_id));
        result.sync_variants = result.sync_variants.map((v: any) => ({
            ...v,
            available: stocks[v.variant_id]?.available ?? null,
        }));

        return NextResponse.json({ result });
    } catch (error) {
         console.error(error);
         return NextResponse.json({ message: 'Error loading product' }, { status: 500 });
    }
}

// Catalog edits (update/delete a product) happen in the Stripe Dashboard now —
// Stripe is the source of truth. The old PUT/DELETE handlers that wrote the Redis
// product store were removed in the Stripe-catalog migration.
