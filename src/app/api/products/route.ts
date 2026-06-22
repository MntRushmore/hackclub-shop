import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { resolveDualPrice } from '../../../lib/variantPricing';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
  try {
    const keys = await redis.keys('product:*');
    const products: any[] = [];

    for (const key of keys) {
        const product = await redis.get<any>(key);
        if (product) {
            products.push({
                id: product.id,
                name: product.name,
                thumbnail_url: product.thumbnail_url,
                sync_variants: (product.variants || []).map((variant: any, idx: number) => ({
                    id: variant.id || `${product.id}_var_${idx}`,
                    variant_id: variant.variant_id || `${product.id}_var_${idx}`,
                    name: variant.name,
                    retail_price: (variant.price ?? 0).toString(),
                    ...resolveDualPrice(variant),
                    size: variant.size || 'One Size',
                    color: variant.color || 'Default',
                    product: {
                        image: variant.image_url || product.image_url || product.thumbnail_url,
                    },
                })),
            });
        }
    }

    return NextResponse.json({ code: 200, result: products });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ code: 500, message: 'Failed to load products' }, { status: 500 });
  }
}
