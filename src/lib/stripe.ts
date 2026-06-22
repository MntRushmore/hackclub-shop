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
