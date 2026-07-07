/**
 * Donation-tier model — the shop's guest pathway is donation-based: you donate
 * at a tier and the merch is the thank-you gift (see DONATION_PIVOT_PROMPT.md).
 *
 * A donation tier is an ordinary catalog product whose Stripe Product config
 * carries a `donation` block (tier name + the gift's fair market value). The
 * checkout route splits each donation line into a taxable gift-FMV portion and
 * a nontaxable donation portion, and stamps the order with an `OrderDonation`
 * summary the receipt email turns into an IRS acknowledgment.
 *
 * Pure data + shape helpers; nothing here talks to Stripe or Redis.
 */

/**
 * Causes a donor can tell us they care about. These are donor PREFERENCES and
 * examples of what donations pay for, not earmarked restricted funds. Hack Club
 * puts every dollar where it helps teens most (see FINANCE_QUESTIONS.md Q5 for
 * the pending finance call on binding restrictions). Ids are stored on orders,
 * so treat the list as append-only.
 */
export interface DonationFund {
    id: string;
    name: string;
    /** One-line pitch shown on the fund picker and receipts. */
    description: string;
}

export const DONATION_FUNDS: DonationFund[] = [
    {
        id: 'laptop',
        name: 'Laptops',
        description: 'Laptops for teens who don\'t have their own. $500 can put one in a teenager\'s hands.',
    },
    {
        id: 'first-hackathon',
        name: 'First hackathons',
        description: 'Travel help so a teen can meet their community in person. Sometimes a bus ticket is all that\'s in the way.',
    },
    {
        id: 'gap-year',
        name: 'Gap years & big projects',
        description: 'Backing teens who take time to build something real.',
    },
    {
        id: 'general',
        name: 'Wherever it\'s needed most',
        description: 'Hack Club puts your donation to work where it matters most.',
    },
];

export const DEFAULT_FUND_ID = 'general';

export function getDonationFund(id: string | undefined): DonationFund {
    return DONATION_FUNDS.find(f => f.id === id) || DONATION_FUNDS.find(f => f.id === DEFAULT_FUND_ID)!;
}

/**
 * Product-level donation config, stored inside the Stripe Product's `config`
 * metadata blob (see catalogMapping.ts). Its presence marks the product as a
 * donation tier; the variant's cash price is the donation amount.
 */
export interface DonationTierConfig {
    /** Tier name shown to donors, e.g. "Philanthropist". */
    tier: string;
    /**
     * Display the amount as open-ended ("$1,000+"): this tier is the entry
     * point for custom giving, topped up via the extra-donation field at
     * checkout. Display-only; the base charge is still the variant price.
     */
    plus?: boolean;
    /**
     * Fair market value (integer cents) of the thank-you gift(s) for this tier.
     * Drives the IRS quid-pro-quo disclosure AND the taxable portion of the
     * checkout: only the FMV is billed as goods; the rest is a donation.
     * Set to the highest-value gift option (or pick combination) when a tier
     * offers a choice.
     */
    fmvCents: number;
    /**
     * How many gift pieces the donor chooses (default 1). At 2, the tier's
     * variants are single pieces: the cart line's variant is pick one, and the
     * second pick arrives as DonationCheckoutInput.secondGiftVariantId.
     */
    giftPicks?: number;
    /** Impact statement, e.g. "Puts a laptop in the hands of a teen." */
    impact?: string;
}

/** Donor-provided fields sent alongside a donation-tier checkout. */
export interface DonationCheckoutInput {
    fundId?: string;
    dedication?: string;   // "in honor of Maya"
    displayName?: string;  // how the donor wants to appear on the donor wall
    anonymous?: boolean;
    // Optional extra donation on top of the tier amount, integer cents. This is
    // how a donor gives a custom amount (e.g. the top tier + extra = any total
    // over $1,000). Pure donation: no gift, fully deductible, nontaxable.
    // One-time even on a monthly donation.
    extraCents?: number;
    // True = bill the tier amount monthly (Stripe subscription) instead of once.
    recurring?: boolean;
    // Second gift choice for a giftPicks-2 tier (variant id on the same
    // product). Checkout validates it against the catalog and holds its stock.
    secondGiftVariantId?: string;
}

/** Ceiling for the extra-donation field: $100,000. Above this, talk to us. */
export const EXTRA_DONATION_MAX_CENTS = 100_000_00;

/**
 * Sanitized donor fields, ready to store on the order. Free-text fields are
 * client-controlled and end up on receipts and (Slice 3) a public donor wall,
 * so they're trimmed and length-capped here — one gate for every caller.
 */
export function sanitizeDonationInput(input: DonationCheckoutInput | undefined): {
    fundId: string;
    dedication?: string;
    displayName?: string;
    isAnonymous: boolean;
    extraCents: number;
    recurring: boolean;
    secondGiftVariantId?: string;
} {
    const clip = (s: unknown, max: number): string | undefined => {
        if (typeof s !== 'string') return undefined;
        const trimmed = s.trim().slice(0, max);
        return trimmed.length > 0 ? trimmed : undefined;
    };
    // Client-controlled money: only a positive integer number of cents within
    // the cap survives; anything else (floats, negatives, NaN, huge) becomes 0.
    const rawExtra = Number(input?.extraCents);
    const extraCents = Number.isSafeInteger(rawExtra) && rawExtra > 0
        ? Math.min(rawExtra, EXTRA_DONATION_MAX_CENTS)
        : 0;
    return {
        fundId: getDonationFund(input?.fundId).id,
        dedication: clip(input?.dedication, 140),
        displayName: clip(input?.displayName, 60),
        isAnonymous: Boolean(input?.anonymous),
        extraCents,
        recurring: Boolean(input?.recurring),
        secondGiftVariantId: clip(input?.secondGiftVariantId, 100),
    };
}

/** The tax-deductible portion: donation minus the gift's fair market value, floored at 0. */
export function deductibleCents(donationCents: number, fmvCents: number): number {
    return Math.max(0, donationCents - fmvCents);
}
