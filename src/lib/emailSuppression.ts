/**
 * Email unsubscribe / suppression.
 *
 * Every email we send carries an unsubscribe link (and an RFC 8058
 * `List-Unsubscribe` header so Gmail/Apple Mail show a native one-click button).
 * Unsubscribing suppresses *marketing* email only — order receipts and
 * shipping/tracking updates are transactional and always send, since customers
 * need them and transactional mail is exempt from opt-out under CAN-SPAM.
 *
 * The unsubscribe link is a signed token, not a database row: we HMAC the
 * recipient's email with NEXTAUTH_SECRET, so the link is tamper-proof and can be
 * minted with no extra storage at send time. Only when someone actually
 * unsubscribes do we write to Redis (a suppression set), which marketing sends
 * consult via `isMarketingSuppressed()`.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Reuse the auth secret for signing; it's already required for the app to run.
// `dev-unsub-secret` only ever applies in local dev with no secret set.
const SECRET = process.env.NEXTAUTH_SECRET || process.env.HACKCLUB_CLIENT_SECRET || 'dev-unsub-secret';

/** Normalize an email the same way everywhere (trim + lowercase). */
function normalize(email: string): string {
    return email.trim().toLowerCase();
}

/** Stable per-email key, matching the hashing already used for guest orders. */
function suppressionKey(email: string): string {
    const hash = createHash('sha256').update(normalize(email)).digest('hex').slice(0, 32);
    return `email:suppressed:${hash}`;
}

/** HMAC token proving the holder of the link controls `email`. URL-safe base64. */
function sign(email: string): string {
    return createHmac('sha256', SECRET)
        .update(normalize(email))
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** Verify a token against an email in constant time. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
    if (!email || !token) return false;
    const expected = sign(email);
    if (expected.length !== token.length) return false;
    try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    } catch {
        return false;
    }
}

/**
 * Build the unsubscribe URL for a recipient. Embeds the email + its signature so
 * the page/POST handler can act without the recipient signing in.
 */
export function unsubscribeUrl(baseUrl: string, email: string): string {
    const params = new URLSearchParams({ email: normalize(email), token: sign(email) });
    return `${baseUrl}/unsubscribe?${params.toString()}`;
}

/** Record an opt-out. Idempotent. Returns false if the token doesn't match. */
export async function suppressMarketing(email: string, token: string): Promise<boolean> {
    if (!verifyUnsubscribeToken(email, token)) return false;
    await redis.set(suppressionKey(email), { at: new Date().toISOString() });
    return true;
}

/** Undo an opt-out (used by the "resubscribe" affordance on the unsubscribe page). */
export async function resubscribeMarketing(email: string, token: string): Promise<boolean> {
    if (!verifyUnsubscribeToken(email, token)) return false;
    await redis.del(suppressionKey(email));
    return true;
}

/**
 * True if this address has opted out of marketing. Transactional sends (receipts,
 * shipping) must NOT consult this — only marketing/promotional sends should.
 */
export async function isMarketingSuppressed(email: string): Promise<boolean> {
    return Boolean(await redis.get(suppressionKey(email)));
}
