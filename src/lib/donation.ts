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
        description: 'Refurbished laptops for teens coding on school Chromebooks. $500 is enough to put one in a teenager\'s hands.',
    },
    {
        id: 'first-hackathon',
        name: 'First hackathons',
        description: 'Travel help so a teen can meet their community in person. $100 is enough to get one teen there.',
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
     * Fair market value (integer cents) of the thank-you gift(s) for this tier.
     * Drives the IRS quid-pro-quo disclosure AND the taxable portion of the
     * checkout: only the FMV is billed as goods; the rest is a donation.
     * Set to the highest-value gift option when a tier offers a choice.
     */
    fmvCents: number;
    /** Impact statement, e.g. "Puts a laptop in the hands of a teen." */
    impact?: string;
}

/** Donor-provided fields sent alongside a donation-tier checkout. */
export interface DonationCheckoutInput {
    fundId?: string;
    dedication?: string;   // "in honor of Maya"
    displayName?: string;  // how the donor wants to appear on the donor wall
    anonymous?: boolean;
}

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
} {
    const clip = (s: unknown, max: number): string | undefined => {
        if (typeof s !== 'string') return undefined;
        const trimmed = s.trim().slice(0, max);
        return trimmed.length > 0 ? trimmed : undefined;
    };
    return {
        fundId: getDonationFund(input?.fundId).id,
        dedication: clip(input?.dedication, 140),
        displayName: clip(input?.displayName, 60),
        isAnonymous: Boolean(input?.anonymous),
    };
}

/** The tax-deductible portion: donation minus the gift's fair market value, floored at 0. */
export function deductibleCents(donationCents: number, fmvCents: number): number {
    return Math.max(0, donationCents - fmvCents);
}
