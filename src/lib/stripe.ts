import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import type { Session } from 'next-auth';
import { isAdmin } from './adminAuth';

/**
 * Stripe runs in one of two modes, backed by two separate key slots:
 *
 *   - `live`: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET — the primary account,
 *     what real customers are charged through.
 *   - `test`: STRIPE_SECRET_KEY_TEST / STRIPE_WEBHOOK_SECRET_TEST — the same
 *     account's test-mode keys, so admins can run end-to-end checkouts with
 *     Stripe's test cards without moving real money.
 *
 * Which mode a checkout uses is resolved per-request (`resolveStripeMode`):
 * an admin's personal override (Redis, `stripe:mode:admin:{userId}`) wins,
 * then the global mode (`stripe:mode`, admin-settable, default live). Guests
 * always get the global mode. Switching to test is only permitted when the
 * test key is configured; if a stored mode's key is missing, checkout fails
 * closed (503) rather than silently charging through the other account.
 *
 * The catalog is NOT mode-switched: Stripe live products/prices stay the
 * source of truth for the storefront. Test-mode checkouts therefore always
 * bill via inline price_data (live Price ids don't exist in the test
 * account), and orders they create are stamped `isTest` so stats, finance,
 * the warehouse queue, and the donor wall all ignore them.
 */

export type StripeMode = 'live' | 'test';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const GLOBAL_MODE_KEY = 'stripe:mode';
const adminModeKey = (userId: string) => `stripe:mode:admin:${userId}`;

function secretKeyFor(mode: StripeMode): string | undefined {
    return mode === 'test' ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
}

export function webhookSecretFor(mode: StripeMode): string | undefined {
    return mode === 'test' ? process.env.STRIPE_WEBHOOK_SECRET_TEST : process.env.STRIPE_WEBHOOK_SECRET;
}

/**
 * Server-side Stripe clients, one per mode. Throws if accessed without the
 * mode's secret key so misconfiguration fails loudly at request time rather
 * than silently.
 */
const _clients: Partial<Record<StripeMode, Stripe>> = {};

export function getStripe(mode: StripeMode = 'live'): Stripe {
    const cached = _clients[mode];
    if (cached) return cached;
    const key = secretKeyFor(mode);
    if (!key) {
        throw new Error(mode === 'test' ? 'STRIPE_SECRET_KEY_TEST is not set' : 'STRIPE_SECRET_KEY is not set');
    }
    const client = new Stripe(key);
    _clients[mode] = client;
    return client;
}

export const isStripeConfigured = (mode: StripeMode = 'live'): boolean => Boolean(secretKeyFor(mode));

/** Sanitize a stored/user-supplied mode value; anything unrecognized is live. */
export const asStripeMode = (value: unknown): StripeMode => (value === 'test' ? 'test' : 'live');

/**
 * The store-wide checkout mode (what guests and admins without a personal
 * override get). Defaults to live; 'test' is only honored while the test key
 * is actually configured, so a leftover Redis flag can never dead-end checkout
 * after the test key is removed.
 */
export async function getGlobalStripeMode(): Promise<StripeMode> {
    try {
        const stored = asStripeMode(await redis.get(GLOBAL_MODE_KEY));
        return stored === 'test' && !isStripeConfigured('test') ? 'live' : stored;
    } catch {
        // Fail safe: a Redis hiccup must not flip real customers into test mode.
        return 'live';
    }
}

export async function setGlobalStripeMode(mode: StripeMode): Promise<void> {
    await redis.set(GLOBAL_MODE_KEY, mode);
}

/**
 * A single admin's personal mode override. Applies only to checkouts started
 * while that admin is signed in; null = follow the global mode.
 */
export async function getAdminStripeMode(userId: string): Promise<StripeMode | null> {
    try {
        const stored = await redis.get(adminModeKey(userId));
        if (stored !== 'test' && stored !== 'live') return null;
        if (stored === 'test' && !isStripeConfigured('test')) return null;
        return stored;
    } catch {
        return null;
    }
}

export async function setAdminStripeMode(userId: string, mode: StripeMode | null): Promise<void> {
    if (mode === null) {
        await redis.del(adminModeKey(userId));
    } else {
        await redis.set(adminModeKey(userId), mode);
    }
}

/**
 * Which mode THIS request's checkout should run in: the signed-in admin's
 * personal override if one is set, otherwise the global mode. Non-admins
 * (guests, students) always get the global mode — the personal override is
 * checked only after an admin-role lookup, so a regular user can never opt
 * themselves into test mode.
 */
export async function resolveStripeMode(session: Session | null): Promise<StripeMode> {
    const userId = session?.user?.id;
    if (userId && (await isAdmin(session))) {
        const personal = await getAdminStripeMode(userId);
        if (personal) return personal;
    }
    return getGlobalStripeMode();
}

/**
 * Whether to ask Stripe to compute sales tax on the checkout. Gated separately
 * from `isStripeConfigured` so the code can ship before tax registrations exist
 * in the Stripe Dashboard — flip STRIPE_TAX_ENABLED on once the nexus/registration
 * setup is done, otherwise Checkout session creation errors. When off, checkout
 * works exactly as before, just without an automatic tax line.
 *
 * Test mode has its own flag (STRIPE_TAX_ENABLED_TEST) because tax registrations
 * are per-mode in Stripe — a live registration doesn't exist in the test account,
 * and requesting automatic_tax without one fails the whole session.
 */
export const isStripeTaxEnabled = (mode: StripeMode = 'live'): boolean => {
    const flag = mode === 'test' ? process.env.STRIPE_TAX_ENABLED_TEST : process.env.STRIPE_TAX_ENABLED;
    return isStripeConfigured(mode) && /^(1|true|yes|on)$/i.test(flag || '');
};

/**
 * Stripe product tax code applied to merch line items (general tangible goods).
 * Correct for shirts/stickers/hardware; refine per-product later if needed.
 * https://docs.stripe.com/tax/tax-codes
 */
export const GENERAL_GOODS_TAX_CODE = 'txcd_99999999';
/**
 * Stripe's "Clothing & footwear" code — several states (Vermont among them,
 * where the shop is registered) exempt clothing from sales tax, so apparel
 * variants (tees, sweatshirts, vests, caps) carry this instead of the general
 * code. Set per-variant via Price metadata `tax_code`; non-apparel gifts
 * (mugs, stickers, totes) stay on the general code.
 */
export const CLOTHING_TAX_CODE = 'txcd_30011000';
/** Shipping tax code — Stripe's standard "Shipping" code (taxable where required). */
export const SHIPPING_TAX_CODE = 'txcd_92010001';
/**
 * Stripe's "Nontaxable" code, applied to the donation portion of a donation-tier
 * checkout (the amount above the thank-you gift's fair market value). Only the
 * FMV portion is billed as goods; a charitable contribution is not a sale.
 * Treatment pending finance sign-off — see DONATION_PIVOT_PROMPT.md.
 */
export const NONTAXABLE_TAX_CODE = 'txcd_00000000';
