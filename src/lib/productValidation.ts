import { Redis } from '@upstash/redis';

interface ProductVariant {
    id: string;
    variant_id: string;
    name: string;
    price: number;
    payment_mode: 'balance_only' | 'points_only' | 'mixed';
    price_balance?: number;
    price_points?: number;
    price_balance_full?: number;
    price_points_full?: number;
    pointsPrice?: number; // Backward compatibility
    size?: string;
    color?: string;
    image_url?: string;
    stock?: number;
}

interface CartItemForValidation {
    id: string;
    name: string;
    price: string;
    quantity: number;
    variant_id?: string;
    pointsSpent?: number; // For mixed items - actual points user chose to spend
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

export async function validateCartItems(items: CartItemForValidation[]): Promise<{
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

        const variant = product.variants.find(v => {
            // Try both exact matches and string conversions
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
            return {
                valid: false,
                error: `Variant not found for ${item.name}`,
            };
        }

        // Check price matches - get the expected price based on payment mode
        let expectedPrice: number;
        const paymentMode = variant.payment_mode || 'balance_only';
        
        // For backward compatibility with old products: if payment_mode is not set,
        // assume balance_only and use the legacy price field
        if (!variant.payment_mode) {
            // Old product without payment_mode - use legacy price
            expectedPrice = variant.price ?? 0;
        } else if (paymentMode === 'balance_only') {
            expectedPrice = variant.price_balance ?? variant.price ?? 0;
        } else if (paymentMode === 'mixed') {
            expectedPrice = variant.price_balance_full ?? variant.price ?? 0;
        } else if (paymentMode === 'points_only') {
            // For points_only, price in cart should be "0" since no balance is charged
            expectedPrice = 0;
        } else {
            expectedPrice = variant.price ?? 0;
        }

        const itemPrice = parseFloat(item.price);
        if (Math.abs(itemPrice - expectedPrice) > 0.01) {  // Allow small floating point differences
            console.log('[Validation] Price mismatch:', {
                itemName: item.name,
                itemPrice,
                expectedPrice,
                paymentMode,
                variant: {
                    price: variant.price,
                    price_balance: variant.price_balance,
                    price_balance_full: variant.price_balance_full,
                }
            });
            return {
                valid: false,
                error: `Price mismatch for ${item.name}: expected ${expectedPrice}, got ${itemPrice}`,
            };
        }

        // Calculate totals based on payment mode
        if (variant.payment_mode === 'balance_only') {
            verifiedTotal += (variant.price_balance || variant.price) * item.quantity;
        } else if (variant.payment_mode === 'points_only') {
            verifiedPointsTotal += (variant.price_points || 0) * item.quantity;
        } else if (variant.payment_mode === 'mixed') {
            // For mixed items, calculate based on actual points spent
            const pointsPerUnit = item.pointsSpent ?? 0;
            const pricePointsFull = variant.price_points_full || 0;
            const priceBalanceFull = variant.price_balance_full || variant.price || 0;
            
            // Calculate ratio of points being used
            const ratio = pricePointsFull > 0 ? pointsPerUnit / pricePointsFull : 0;
            
            // Balance is the remaining portion
            const balancePerUnit = priceBalanceFull * (1 - ratio);
            
            verifiedTotal += balancePerUnit * item.quantity;
            verifiedPointsTotal += pointsPerUnit * item.quantity;
        }
        
        verifiedItems.push({
            id: item.id,
            name: variant.name,
            price: variant.price.toString(),
            pointsPrice: variant.price_points || variant.pointsPrice,
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
