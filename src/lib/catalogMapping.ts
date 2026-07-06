/**
 * Catalog <-> Stripe field mapping — the single contract for the "Stripe is the
 * source of truth for the catalog" migration.
 *
 * The model:
 *   - one Stripe Product  ==  one shop Product (name, description, images, +
 *     product-level config stored as metadata JSON)
 *   - one Stripe Price    ==  one ProductVariant (USD cash price as unit_amount;
 *     everything Stripe can't model — points price, variant id, sku, stock,
 *     unitCost, size/color/weight — rides along as Price.metadata)
 *
 * Stripe has no first-class "variant", so a Product groups its variant Prices.
 * The variant id (`variant_id`) is the join key the rest of the app uses
 * (inventory, costing, orders), so it MUST survive the round-trip — it lives in
 * Price.metadata.variant_id and is what the cache projection rebuilds from.
 *
 * Nothing here talks to Stripe or Redis; it's pure shape conversion so the
 * import script, the webhook projection, and tests can all share one mapping.
 */

import type { Product, ProductVariant, ShippingOption, CheckoutField } from '../types/Admin';
import type { DonationTierConfig } from './donation';
import { resolveDualPrice } from './variantPricing';
import { GENERAL_GOODS_TAX_CODE } from './stripe';

/** Marks a Stripe Product/Price as managed by this shop (vs. hand-made ones). */
export const CATALOG_MANAGED_FLAG = 'hackclub_shop';

/** Stripe metadata is string-valued; numbers/JSON are stringified on write. */
type StripeMetadata = Record<string, string>;

/** Round a USD amount to integer cents for Stripe's unit_amount. */
export function toStripeAmount(usd: number): number {
    return Math.round(usd * 100);
}

/** Inverse of toStripeAmount: integer cents -> USD float. */
export function fromStripeAmount(cents: number): number {
    return Math.round(cents) / 100;
}

/** The canonical variant id used as the cross-app join key. */
export function variantKey(variant: ProductVariant): string {
    return String(variant.variant_id || variant.id);
}

// ---------------------------------------------------------------------------
// Catalog -> Stripe (used by the import script and any future write-back)
// ---------------------------------------------------------------------------

/**
 * Product-level config that has no native Stripe home. Stored as a single JSON
 * metadata blob (`config`) on the Stripe Product. Kept compact — Stripe caps a
 * single metadata value at 500 chars, so very large shipping/field configs are a
 * known limit we surface at import time rather than silently truncating.
 */
export interface StripeProductConfig {
    category?: string;
    image_url?: string;
    thumbnail_url?: string;
    draft?: boolean;
    shippingOptions?: ShippingOption[];
    checkoutFields?: CheckoutField[];
    // Present iff the product is a donation tier (the cash price is the donation
    // amount; the merch is the thank-you gift). See src/lib/donation.ts.
    donation?: DonationTierConfig;
}

/** Build the Stripe Product create/update payload for a shop product. */
export function toStripeProduct(product: Product): {
    name: string;
    description?: string;
    images: string[];
    tax_code: string;
    metadata: StripeMetadata;
} {
    const config: StripeProductConfig = {
        category: product.category,
        image_url: product.image_url,
        thumbnail_url: product.thumbnail_url,
        draft: product.draft,
        shippingOptions: product.shippingOptions,
        checkoutFields: product.checkoutFields,
        donation: product.donation,
    };
    // Stripe only accepts absolute http(s) image URLs; a relative path (e.g.
    // "/images/x.png") makes Product create/update fail with url_invalid. Drop any
    // non-absolute url here (the original path still round-trips via config metadata
    // for the storefront, which can serve relative paths fine).
    const images = [product.image_url, product.thumbnail_url].filter(
        (u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u),
    );
    return {
        name: product.name,
        description: product.description || undefined,
        images: Array.from(new Set(images)).slice(0, 8), // Stripe caps images at 8
        // Tax classification lives on the Stripe Product so checkout can bill by
        // price_id and Stripe Tax still classifies the line. General tangible goods
        // (shirts/stickers/hardware); refine per-product later if a category differs.
        tax_code: GENERAL_GOODS_TAX_CODE,
        metadata: {
            managed_by: CATALOG_MANAGED_FLAG,
            shop_product_id: product.id,
            config: JSON.stringify(config),
        },
    };
}

/**
 * Build the Stripe Price metadata for a variant. The USD cash price becomes the
 * Price.unit_amount (returned separately); everything else is metadata.
 * Returns `unitAmount: null` for a variant with no cash price (points-only) — the
 * caller must still create a Price (Stripe requires one) using a $0 unit_amount
 * with `is_cash_buyable=0`, so the storefront knows it's points-only.
 */
export function toStripePrice(variant: ProductVariant): {
    unitAmount: number; // integer cents; 0 for points-only
    isCashBuyable: boolean;
    metadata: StripeMetadata;
} {
    const { price_cash, price_points } = resolveDualPrice(variant);
    const metadata: StripeMetadata = {
        managed_by: CATALOG_MANAGED_FLAG,
        variant_id: variantKey(variant),
        name: variant.name ?? '',
    };
    // Only set metadata keys that have a value — keeps the Stripe object clean and
    // makes "unset" round-trip back to undefined instead of "undefined"/"NaN".
    if (typeof price_points === 'number') metadata.price_points = String(price_points);
    if (typeof variant.unitCost === 'number') metadata.unit_cost = String(variant.unitCost);
    if (typeof variant.stock === 'number') metadata.stock = String(variant.stock);
    if (typeof variant.weightOz === 'number') metadata.weight_oz = String(variant.weightOz);
    if (typeof variant.reorderPoint === 'number') metadata.reorder_point = String(variant.reorderPoint);
    if (variant.size) metadata.size = variant.size;
    if (variant.color) metadata.color = variant.color;
    if (variant.image_url) metadata.image_url = variant.image_url;
    if (variant.sku) metadata.sku = variant.sku;
    if (variant.scanCode) metadata.scan_code = variant.scanCode;

    return {
        unitAmount: typeof price_cash === 'number' ? toStripeAmount(price_cash) : 0,
        isCashBuyable: typeof price_cash === 'number' && price_cash > 0,
        metadata,
    };
}

// ---------------------------------------------------------------------------
// Stripe -> Catalog (used by the cache projection the storefront/checkout read)
// ---------------------------------------------------------------------------

/** A read-only projection of the Stripe catalog, shaped like the old Redis Product. */
export interface CatalogVariant {
    id: string;
    variant_id: string;
    name: string;
    price: number;          // legacy USD field == price_cash (or 0), for old readers
    price_cash?: number;
    price_points?: number;
    size?: string;
    color?: string;
    image_url?: string;
    stock?: number;
    weightOz?: number;
    unitCost?: number;
    reorderPoint?: number;
    sku?: string;
    scanCode?: string;
    stripePriceId: string;  // the Stripe Price this variant maps to (checkout uses it)
}

export interface CatalogProduct {
    id: string;
    name: string;
    description: string;
    thumbnail_url?: string;
    image_url?: string;
    category?: string;
    variants: CatalogVariant[];
    shippingOptions: ShippingOption[];
    checkoutFields: CheckoutField[];
    draft?: boolean;
    // Present iff this product is a donation tier (see src/lib/donation.ts).
    donation?: DonationTierConfig;
    createdAt?: string; // ISO, from the Stripe Product's `created` — for "newest" sorting
    stripeProductId: string;
}

function num(v: string | undefined): number | undefined {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/** Parse the product-level config blob, tolerating a malformed/missing value. */
export function parseProductConfig(raw: string | undefined): StripeProductConfig {
    if (!raw) return {};
    try {
        return JSON.parse(raw) as StripeProductConfig;
    } catch {
        return {};
    }
}

/** Rebuild a single catalog variant from a Stripe Price's metadata + amount. */
export function fromStripePrice(price: {
    id: string;
    unit_amount: number | null;
    metadata: Record<string, string>;
}): CatalogVariant {
    const m = price.metadata || {};
    const isCashBuyable = m.is_cash_buyable !== '0' && (price.unit_amount ?? 0) > 0;
    const cash = isCashBuyable && price.unit_amount != null ? fromStripeAmount(price.unit_amount) : undefined;
    const variantId = m.variant_id || price.id;
    return {
        id: variantId,
        variant_id: variantId,
        name: m.name || '',
        price: cash ?? 0,
        price_cash: cash,
        price_points: num(m.price_points),
        size: m.size || undefined,
        color: m.color || undefined,
        image_url: m.image_url || undefined,
        stock: num(m.stock),
        weightOz: num(m.weight_oz),
        unitCost: num(m.unit_cost),
        reorderPoint: num(m.reorder_point),
        sku: m.sku || undefined,
        scanCode: m.scan_code || undefined,
        stripePriceId: price.id,
    };
}
