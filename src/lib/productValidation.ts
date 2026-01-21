import path from 'path';
import { promises as fs } from 'fs';

interface ProductVariant {
    id: number;
    variant_id: number;
    name: string;
    retail_price: string;
    size: string;
    color: string;
}

interface Product {
    id: number;
    name: string;
    thumbnail_url: string;
    sync_variants: ProductVariant[];
}

let cachedProducts: Product[] | null = null;

async function loadProducts(): Promise<Product[]> {
    if (cachedProducts) return cachedProducts;
    
    const jsonDirectory = path.join(process.cwd(), 'src', 'data');
    const fileContents = await fs.readFile(jsonDirectory + '/products.json', 'utf8');
    cachedProducts = JSON.parse(fileContents);
    return cachedProducts!;
}

export async function validateCartItems(items: { id: string; name: string; price: string; quantity: number; variant_id?: number }[]): Promise<{
    valid: boolean;
    error?: string;
    verifiedTotal?: number;
    items?: { id: string; name: string; price: string; quantity: number; thumbnail_url?: string }[];
}> {
    const products = await loadProducts();
    let verifiedTotal = 0;
    const verifiedItems: { id: string; name: string; price: string; quantity: number; thumbnail_url?: string }[] = [];

    for (const item of items) {
        let found = false;
        
        for (const product of products) {
            for (const variant of product.sync_variants) {
                // Match by variant_id if provided, otherwise by name
                if (item.variant_id && variant.variant_id === item.variant_id) {
                    // Verify price matches
                    if (item.price !== variant.retail_price) {
                        return {
                            valid: false,
                            error: `Price mismatch for ${item.name}: expected ${variant.retail_price}, got ${item.price}`,
                        };
                    }
                    verifiedTotal += parseFloat(variant.retail_price) * item.quantity;
                    verifiedItems.push({
                        id: item.id,
                        name: variant.name,
                        price: variant.retail_price,
                        quantity: item.quantity,
                        thumbnail_url: product.thumbnail_url,
                    });
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        
        if (!found) {
            return {
                valid: false,
                error: `Product not found: ${item.name}`,
            };
        }
    }

    return {
        valid: true,
        verifiedTotal,
        items: verifiedItems,
    };
}

export async function getProductByVariantId(variantId: number): Promise<{ product: Product; variant: ProductVariant } | null> {
    const products = await loadProducts();
    
    for (const product of products) {
        for (const variant of product.sync_variants) {
            if (variant.variant_id === variantId) {
                return { product, variant };
            }
        }
    }
    
    return null;
}
