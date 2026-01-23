import { Redis } from '@upstash/redis';

interface ProductVariant {
    id: string;
    variant_id: string;
    name: string;
    price: number;
    pointsPrice?: number;
    size?: string;
    color?: string;
    image_url?: string;
    stock?: number;
}

interface AdminProduct {
    id: string;
    name: string;
    thumbnail_url?: string;
    image_url?: string;
    category?: string;
    variants: ProductVariant[];
}

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

async function loadProducts(): Promise<AdminProduct[]> {
    try {
        const keys = await redis.keys('product:*');
        const products: AdminProduct[] = [];

        for (const key of keys) {
            const product = await redis.get<AdminProduct>(key);
            if (product) {
                products.push(product);
            }
        }

        return products;
    } catch (error) {
        console.error('Failed to load products from Redis:', error);
        return [];
    }
}

export async function validateCartItems(items: { id: string; name: string; price: string; quantity: number; variant_id?: string }[]): Promise<{
    valid: boolean;
    error?: string;
    verifiedTotal?: number;
    verifiedPointsTotal?: number;
    items?: { id: string; name: string; price: string; pointsPrice?: number; quantity: number; thumbnail_url?: string }[];
}> {
    const products = await loadProducts();
    let verifiedTotal = 0;
    let verifiedPointsTotal = 0;
    const verifiedItems: { id: string; name: string; price: string; pointsPrice?: number; quantity: number; thumbnail_url?: string }[] = [];

    for (const item of items) {
        const product = products.find(p => p.id === item.id);
        
        if (!product) {
            return {
                valid: false,
                error: `Product not found: ${item.name}`,
            };
        }

        const variant = product.variants.find(v => v.variant_id === item.variant_id || v.id === item.variant_id);
        
        if (!variant) {
            return {
                valid: false,
                error: `Variant not found for ${item.name}`,
            };
        }

        if (item.price !== variant.price.toString()) {
            return {
                valid: false,
                error: `Price mismatch for ${item.name}: expected ${variant.price}, got ${item.price}`,
            };
        }

        verifiedTotal += variant.price * item.quantity;
        verifiedPointsTotal += (variant.pointsPrice || 0) * item.quantity;
        verifiedItems.push({
            id: item.id,
            name: variant.name,
            price: variant.price.toString(),
            pointsPrice: variant.pointsPrice,
            quantity: item.quantity,
            thumbnail_url: variant.image_url || product.image_url || product.thumbnail_url,
        });
    }

    return {
        valid: true,
        verifiedTotal,
        verifiedPointsTotal,
        items: verifiedItems,
    };
}

export async function getProductById(productId: string): Promise<AdminProduct | null> {
    const product = await redis.get<AdminProduct>(`product:${productId}`);
    return product || null;
}
