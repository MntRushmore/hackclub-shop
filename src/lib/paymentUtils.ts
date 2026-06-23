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

/**
 * True if the variant can be bought on the given pathway. Admins (full-catalog
 * mode) can buy anything priced either way, so a variant is available to them
 * if it has a points OR a cash price.
 */
export function isAvailableOn(variant: any, pathway: Pathway): boolean {
    if (pathway === 'admin') return getPointsPrice(variant) > 0 || getCashPrice(variant) > 0;
    return pathway === 'student' ? getPointsPrice(variant) > 0 : getCashPrice(variant) > 0;
}

/**
 * The price to SHOW for a variant on a given pathway: dollars for guests,
 * points for students. Admins see both (whichever the variant has), joined
 * with a separator. Returns a display string, or null if the variant isn't
 * available on that pathway.
 */
export function getDisplayPrice(variant: any, pathway: Pathway): string | null {
    const p = getPointsPrice(variant);
    const c = getCashPrice(variant);
    if (pathway === 'admin') {
        const parts: string[] = [];
        if (p > 0) parts.push(formatPoints(p));
        if (c > 0) parts.push(formatCash(c));
        return parts.length > 0 ? parts.join(' · ') : null;
    }
    if (pathway === 'student') {
        return p > 0 ? formatPoints(p) : null;
    }
    return c > 0 ? formatCash(c) : null;
}
