import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { resolveDualPrice } from '../../../lib/variantPricing';
import { getVariantStocks } from '../../../lib/inventory';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
  try {
    const keys = await redis.keys('product:*');
    const rawProducts: any[] = [];
    for (const key of keys) {
        const product = await redis.get<any>(key);
        if (product) rawProducts.push(product);
    }

    // Enrich variants with live availability in one batched stock read. `available`
    // is null for untracked variants (unlimited) and a number when stock is tracked.
    const variantIds = rawProducts.flatMap((p: any) =>
        (p.variants || []).map((v: any, idx: number) => v.variant_id || v.id || `${p.id}_var_${idx}`),
    );
    const stocks = await getVariantStocks(variantIds);

    const products = rawProducts.map((product: any) => ({
        id: product.id,
        name: product.name,
        thumbnail_url: product.thumbnail_url,
        category: product.category || null,
        createdAt: product.createdAt || null,
        sync_variants: (product.variants || []).map((variant: any, idx: number) => {
            const variantId = variant.variant_id || variant.id || `${product.id}_var_${idx}`;
            const available = stocks[variantId]?.available ?? null;
            return {
                id: variant.id || `${product.id}_var_${idx}`,
                variant_id: variantId,
                name: variant.name,
                retail_price: (variant.price ?? 0).toString(),
                ...resolveDualPrice(variant),
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
