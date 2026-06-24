/**
 * SKU: the human-readable, store-wide-unique identifier printed on a variant's
 * label and encoded in its barcode/QR.
 *
 * Identity today is the opaque `variant_id` (`var_169..._0`) — fine for machines,
 * useless on a label a human reads aloud. A SKU like `HC-STICKER-3IN-RED` is
 * scannable AND legible, works in the search box, and never exposes the internal
 * id scheme on physical goods.
 *
 * The barcode/QR encodes the SKU (not the variant_id, not a URL with secrets), so a
 * scan resolves to a variant via the `sku:{sku}` reverse index in O(1). SKUs are
 * non-secret — they live on physical product — so they must never embed price,
 * cost, or PII.
 *
 * Conventions match the rest of the codebase: Upstash Redis is the source of truth,
 * and all index maintenance is fire-and-forget safe like inventory/airtableMirror.
 */

import { Redis } from '@upstash/redis';
import { Product, ProductVariant } from '../types/Admin';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/** Reverse index: a scanned SKU → the variant it identifies (O(1) scan resolution). */
const skuKey = (sku: string) => `sku:${normalizeSku(sku)}`;

/** The canonical variant identifier used everywhere (inventory, costing, receipts). */
export const variantKey = (v: Pick<ProductVariant, 'variant_id' | 'id'>) =>
    String(v.variant_id || v.id);

/**
 * Canonical form of a SKU: uppercased, trimmed, internal whitespace → single hyphen,
 * only A–Z 0–9 and hyphen kept, collapsed/edge hyphens removed. The form we store,
 * index, print, and compare. A scanner that emits lowercase or stray spaces still
 * resolves.
 */
export function normalizeSku(raw: string): string {
    return (raw || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

/** A short, alphanumeric token from a string (vowels dropped if long, capped). */
function token(input: string | undefined, max: number): string {
    const clean = normalizeSku(input || '').replace(/-/g, '');
    if (!clean) return '';
    if (clean.length <= max) return clean;
    // Drop vowels (keep first char) to keep it pronounceable-ish, then hard-cap.
    const squeezed = clean[0] + clean.slice(1).replace(/[AEIOU]/g, '');
    return (squeezed.length >= 2 ? squeezed : clean).slice(0, max);
}

/**
 * Build a candidate SKU from product + variant fields:
 *   HC-{CATEGORY}-{PRODUCT}-{SIZE}{COLOR}
 * Each segment best-effort; empty segments are skipped. Not yet uniqueness-checked
 * — `assignSku` resolves collisions with a numeric suffix.
 */
export function buildSkuCandidate(product: Pick<Product, 'name' | 'category'>, variant: ProductVariant): string {
    const segs = [
        'HC',
        token(product.category, 8),
        token(product.name, 10),
        token([variant.size, variant.color].filter(Boolean).join('-') || variant.name, 8),
    ].filter(Boolean);
    const candidate = normalizeSku(segs.join('-'));
    return candidate || `HC-${token(variantKey(variant), 10)}`;
}

/** Resolve a scanned/typed SKU back to the variant id it points at (null if unknown). */
export async function resolveSku(rawSku: string): Promise<string | null> {
    const sku = normalizeSku(rawSku);
    if (!sku) return null;
    try {
        const variantId = await redis.get<string>(skuKey(sku));
        return variantId ? String(variantId) : null;
    } catch (err) {
        console.error('[sku] resolve failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

/** Is this SKU free, or already claimed by a *different* variant? */
async function skuTaken(sku: string, byVariantId: string): Promise<boolean> {
    const owner = await redis.get<string>(skuKey(sku));
    return owner != null && String(owner) !== String(byVariantId);
}

export interface AssignSkuResult {
    sku: string;          // the normalized SKU now stored on the variant + indexed
    changed: boolean;     // false if the variant already had exactly this SKU
}

/**
 * Assign a SKU to a variant: normalize, ensure store-wide uniqueness (numeric suffix
 * on collision), write it onto the product variant, and maintain the reverse index
 * (claim the new key, release the old one). Mutates and persists the passed `product`.
 *
 * Pass `desired` to set a specific SKU (admin edit); omit to auto-generate from the
 * product/variant fields. Throws only on a hard Redis failure on the write path —
 * index/uniqueness reads degrade safely.
 */
export async function assignSku(
    product: Product,
    variantId: string,
    desired?: string,
): Promise<AssignSkuResult> {
    const variant = (product.variants || []).find(v => variantKey(v) === String(variantId));
    if (!variant) throw new Error('Variant not found');

    const base = desired && desired.trim()
        ? normalizeSku(desired)
        : buildSkuCandidate(product, variant);
    if (!base) throw new Error('Could not derive a SKU');

    if (variant.sku && normalizeSku(variant.sku) === base) {
        return { sku: base, changed: false };
    }

    // Find a free SKU: base, then base-2, base-3, … (cap the probe; collisions are rare).
    let sku = base;
    for (let n = 2; n <= 50 && (await skuTaken(sku, variantId)); n++) {
        sku = `${base}-${n}`;
    }

    const prev = variant.sku ? normalizeSku(variant.sku) : null;

    // Persist onto the variant, then move the index. Order: write product first so the
    // SKU is durable even if the index write hiccups; then claim new, release old.
    variant.sku = sku;
    product.updatedAt = new Date();
    await redis.set(`product:${product.id}`, product);

    await redis.set(skuKey(sku), variantId);
    if (prev && prev !== sku) {
        // Only release the old key if it still points at us (don't clobber a reassignment).
        const oldOwner = await redis.get<string>(skuKey(prev));
        if (oldOwner != null && String(oldOwner) === String(variantId)) {
            await redis.del(skuKey(prev));
        }
    }

    return { sku, changed: true };
}
