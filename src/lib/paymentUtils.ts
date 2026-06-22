import type { Pathway } from './usePathway';

/** Cash (USD) price, or 0 if the variant isn't sold for money. */
export function getCashPrice(variant: any): number {
    return variant?.price_cash ?? 0;
}

/** Points price, or 0 if the variant isn't sold for points. */
export function getPointsPrice(variant: any): number {
    return variant?.price_points ?? 0;
}

export function formatCash(n: number): string {
    return `$${n.toFixed(2)}`;
}

export function formatPoints(n: number): string {
    return `${Math.round(n)} pts`;
}

/** True if the variant can be bought on the given pathway. */
export function isAvailableOn(variant: any, pathway: Pathway): boolean {
    return pathway === 'student' ? getPointsPrice(variant) > 0 : getCashPrice(variant) > 0;
}

/**
 * The price to SHOW for a variant on a given pathway: dollars for guests,
 * points for students. Returns a display string, or null if the variant
 * isn't available on that pathway.
 */
export function getDisplayPrice(variant: any, pathway: Pathway): string | null {
    if (pathway === 'student') {
        const p = getPointsPrice(variant);
        return p > 0 ? formatPoints(p) : null;
    }
    const c = getCashPrice(variant);
    return c > 0 ? formatCash(c) : null;
}
