import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

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
                sync_variants: (product.variants || []).map((variant: any, idx: number) => {
                    const base = {
                        id: variant.id || `${product.id}_var_${idx}`,
                        variant_id: variant.variant_id || `${product.id}_var_${idx}`,
                        name: variant.name,
                        retail_price: variant.price.toString(),
                        payment_mode: variant.payment_mode || 'balance_only',
                        size: variant.size || 'One Size',
                        color: variant.color || 'Default',
                        product: {
                            image: variant.image_url || product.image_url || product.thumbnail_url,
                        },
                    };
                    
                    // Add payment mode specific fields
                    if (variant.payment_mode === 'balance_only') {
                        return {
                            ...base,
                            price_balance: variant.price_balance || variant.price,
                        };
                    } else if (variant.payment_mode === 'points_only') {
                        return {
                            ...base,
                            price_points: variant.price_points || variant.pointsPrice || 0,
                        };
                    } else if (variant.payment_mode === 'mixed') {
                        return {
                            ...base,
                            price_balance_full: variant.price_balance_full || variant.price,
                            price_points_full: variant.price_points_full || variant.pointsPrice || 0,
                        };
                    }
                    
                    // Fallback for old data
                    return {
                        ...base,
                        price_balance: variant.price,
                        points_price: variant.pointsPrice || 0,
                    };
                }),
            });
        }
    }

    return NextResponse.json({ code: 200, result: products });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ code: 500, message: 'Failed to load products' }, { status: 500 });
  }
}
