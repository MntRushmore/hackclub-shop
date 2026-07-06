/**
 * Shared bits for the "/backed" donation share card (page + OG image + the
 * thank-you page's share block). Everything here is derived from two
 * client-visible query params (tier, vest number), so it's display-only by
 * design: nothing sensitive rides on it, and both params are validated against
 * these allowlists before rendering.
 */

/** Tiers a share card may name — anything else renders the generic card. */
export const SHAREABLE_TIERS = [
    'Supporter',
    'Friend',
    'Champion',
    'Patron',
    'Philanthropist',
    'Parents Founders Circle',
    'Sustainer',
] as const;

export function normalizeShareTier(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const match = SHAREABLE_TIERS.find((t) => t.toLowerCase() === raw.trim().toLowerCase());
    return match || null;
}

/** Vest numbers are 1–100; anything else is dropped. */
export function normalizeShareNumber(raw: string | null | undefined): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

export function shareHeadline(tier: string | null, num: number | null): string {
    if (tier === 'Philanthropist' && num) return `We hold vest #${String(num).padStart(3, '0')} of 100.`;
    if (tier === 'Parents Founders Circle') return "We're in the Parents Founders Circle.";
    if (tier) return `We're a Hack Club ${tier}.`;
    return 'We backed a teenager.';
}

export function shareSubline(tier: string | null): string {
    if (tier === 'Philanthropist') return 'Only 100 of these vests will ever be made. Ours stands for a donation to the teenagers of Hack Club.';
    return 'Our donation funds the teenagers who build, ship, and dream at Hack Club.';
}

/** The share text a donor posts (thank-you page copy button + share intents). */
export function shareText(tier: string | null, num: number | null, url: string): string {
    return `${shareHeadline(tier, num)} ${shareSubline(tier)} ${url}`;
}
