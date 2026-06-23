import { Redis } from '@upstash/redis';
import { resolveDualPrice } from './variantPricing';

interface ProductVariant {
    id: string;
    variant_id: string;
    name: string;
    price: number;
    price_cash?: number;
    price_points?: number;
    // legacy fields still present on older Redis records; resolveDualPrice folds them in.
    payment_mode?: 'balance_only' | 'points_only' | 'mixed';
    price_balance?: number;
    price_balance_full?: number;
    price_points_full?: number;
    pointsPrice?: number;
    size?: string;
    color?: string;
    image_url?: string;
    stock?: number;
    unitCost?: number; // finance: cost basis per unit (USD), captured onto sold lines
}

interface CartItemForValidation {
    id: string;
    name: string;
    price: string;
    quantity: number;
    variant_id?: string;
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

export interface VerifiedCartItem {
    id: string;
    name: string;
    price: string;          // USD string (cash price, or "0" for points-only items)
    priceCash?: number;     // verified per-unit USD price (adult/Stripe path)
    pricePoints?: number;   // verified per-unit points price (student path)
    quantity: number;
    thumbnail_url?: string;
    variantId: string;      // canonical variant id, for stock reservation
    unitCost?: number;      // finance: cost basis per unit (USD) at time of sale
}

/**
 * Re-loads every product from Redis and re-derives the authoritative price for each
 * cart item. The client-sent `price` is only cross-checked, never trusted. Returns
 * both a verified cash total (adult/Stripe path) and a verified points total
 * (student path); the caller charges whichever matches the pathway.
 */
export async function validateCartItems(items: CartItemForValidation[]): Promise<{
    valid: boolean;
    error?: string;
    verifiedCashTotal?: number;
    verifiedPointsTotal?: number;
    items?: VerifiedCartItem[];
}> {
    const products = await loadProducts();
    let verifiedCashTotal = 0;
    let verifiedPointsTotal = 0;
    const verifiedItems: VerifiedCartItem[] = [];

    for (const item of items) {
        const product = products.find(p => p.id === item.id);

        if (!product) {
            return { valid: false, error: `Product not found: ${item.name}` };
        }

        const variant = product.variants.find(v => {
            return (
                v.variant_id === item.variant_id ||
                v.id === item.variant_id ||
                String(v.variant_id) === String(item.variant_id) ||
                String(v.id) === String(item.variant_id)
            );
        });

        if (!variant) {
            console.log('[Validation] Variant not found:', {
                itemName: item.name,
                itemVariantId: item.variant_id,
                productId: product.id,
                availableVariants: product.variants.map(v => ({ id: v.id, variant_id: v.variant_id }))
            });
            return { valid: false, error: `Variant not found for ${item.name}` };
        }

        const { price_cash, price_points } = resolveDualPrice(variant);

        // Cross-check the client-sent cash price against the resolved one. Cart carries
        // the USD price as `price` ("0" for points-only items), so the expected value is
        // the cash price or 0 when the item is points-only.
        const expectedPrice = price_cash ?? 0;
        const itemPrice = parseFloat(item.price);
        if (Math.abs(itemPrice - expectedPrice) > 0.01) {
            console.log('[Validation] Price mismatch:', { itemName: item.name, itemPrice, expectedPrice });
            return {
                valid: false,
                error: `Price mismatch for ${item.name}: expected ${expectedPrice}, got ${itemPrice}`,
            };
        }

        verifiedCashTotal += (price_cash ?? 0) * item.quantity;
        verifiedPointsTotal += (price_points ?? 0) * item.quantity;

        verifiedItems.push({
            id: item.id,
            name: variant.name,
            price: (price_cash ?? 0).toString(),
            priceCash: price_cash,
            pricePoints: price_points,
            quantity: item.quantity,
            thumbnail_url: variant.image_url || product.image_url || product.thumbnail_url,
            variantId: String(variant.variant_id || variant.id),
            unitCost: typeof variant.unitCost === 'number' && variant.unitCost >= 0 ? variant.unitCost : undefined,
        });
    }

    return {
        valid: true,
        verifiedCashTotal,
        verifiedPointsTotal,
        items: verifiedItems,
    };
}

export async function getProductById(productId: string): Promise<AdminProduct | null> {
    const product = await redis.get<AdminProduct>(`product:${productId}`);
    return product || null;
}
