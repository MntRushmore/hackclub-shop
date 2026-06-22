/**
 * Maps a stored product variant to the dual-price wire shape used across the shop.
 *
 * New model: a variant carries an optional `price_cash` (USD, adult/Stripe path) and
 * an optional `price_points` (student path). A variant is buyable on a pathway iff
 * that price is present and > 0.
 *
 * Backward-compat: older variants in Redis used `payment_mode` + `price_balance` /
 * `price_balance_full` / `price_points_full` / `pointsPrice`. We fold those legacy
 * fields into the new shape on read so existing products keep rendering.
 */
export function resolveDualPrice(variant: any): { price_cash?: number; price_points?: number } {
    // Prefer the new fields when present.
    let cash: number | undefined = typeof variant.price_cash === 'number' ? variant.price_cash : undefined;
    let points: number | undefined = typeof variant.price_points === 'number' ? variant.price_points : undefined;

    // Legacy fallbacks for products written before the dual-price migration.
    if (cash === undefined) {
        if (variant.payment_mode === 'balance_only') {
            cash = variant.price_balance ?? variant.price;
        } else if (variant.payment_mode === 'mixed') {
            cash = variant.price_balance_full ?? variant.price;
        } else if (variant.payment_mode === undefined && variant.price != null) {
            // Very old product with no payment_mode at all.
            cash = variant.price;
        }
    }
    if (points === undefined) {
        if (variant.payment_mode === 'mixed') {
            points = variant.price_points_full ?? variant.pointsPrice;
        } else if (variant.payment_mode === 'points_only') {
            points = variant.price_points ?? variant.pointsPrice;
        } else if (variant.pointsPrice != null) {
            points = variant.pointsPrice;
        }
    }

    const out: { price_cash?: number; price_points?: number } = {};
    if (typeof cash === 'number' && cash > 0) out.price_cash = cash;
    if (typeof points === 'number' && points > 0) out.price_points = points;
    return out;
}
