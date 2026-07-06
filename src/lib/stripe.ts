import Stripe from 'stripe';

/**
 * Server-side Stripe client. Throws if accessed without a configured secret key
 * so misconfiguration fails loudly at request time rather than silently.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
    if (_stripe) return _stripe;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error('STRIPE_SECRET_KEY is not set');
    }
    _stripe = new Stripe(key);
    return _stripe;
}

export const isStripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

/**
 * Whether to ask Stripe to compute sales tax on the checkout. Gated separately
 * from `isStripeConfigured` so the code can ship before tax registrations exist
 * in the Stripe Dashboard — flip STRIPE_TAX_ENABLED on once the nexus/registration
 * setup is done, otherwise Checkout session creation errors. When off, checkout
 * works exactly as before, just without an automatic tax line.
 */
export const isStripeTaxEnabled = (): boolean =>
    isStripeConfigured() && /^(1|true|yes|on)$/i.test(process.env.STRIPE_TAX_ENABLED || '');

/**
 * Stripe product tax code applied to merch line items (general tangible goods).
 * Correct for shirts/stickers/hardware; refine per-product later if needed.
 * https://docs.stripe.com/tax/tax-codes
 */
export const GENERAL_GOODS_TAX_CODE = 'txcd_99999999';
/** Shipping tax code — Stripe's standard "Shipping" code (taxable where required). */
export const SHIPPING_TAX_CODE = 'txcd_92010001';
/**
 * Stripe's "Nontaxable" code, applied to the donation portion of a donation-tier
 * checkout (the amount above the thank-you gift's fair market value). Only the
 * FMV portion is billed as goods; a charitable contribution is not a sale.
 * Treatment pending finance sign-off — see DONATION_PIVOT_PROMPT.md.
 */
export const NONTAXABLE_TAX_CODE = 'txcd_00000000';
