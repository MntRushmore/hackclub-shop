/**
 * Launch lock — shared helpers for the site-wide "coming soon" gate.
 *
 * Used by both the Edge middleware (src/middleware.ts) and the unlock route
 * handler (src/app/api/launch/unlock/route.ts), so everything here is written
 * against Web Crypto (crypto.subtle) and plain env access — no Node APIs, no
 * Redis, nothing that can't run on the Edge runtime.
 *
 * This is a soft "coming soon" wall, not a hard authorization boundary. Real
 * authz lives in the API routes / adminAuth; this just decides whether an
 * unannounced storefront is visible yet. The one secret that matters
 * (LAUNCH_PASSWORD) never reaches the client: the browser only ever holds an
 * HMAC of a fixed string, and the password is verified server-side.
 */

// The cookie the browser carries once unlocked. Bump COOKIE_VERSION to
// invalidate every outstanding unlock at once (e.g. after rotating the wall).
export const COOKIE_NAME = 'launch_unlock';
export const COOKIE_VERSION = 'v1';

// 30 days. Long enough that a visitor who unlocks once isn't re-prompted for
// the whole pre-launch window.
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Paths that must keep working while the site is locked. Prefix-matched, kept
// deliberately tight — NEVER widen this to a bare '/api/', which would expose
// orders/checkout/points/etc. to the public while we're "locked".
export const ALLOWLIST_PREFIXES = [
    '/launch', // the lock page itself
    '/api/launch/', // its unlock endpoint
    '/api/auth/', // NextAuth OAuth flow — admins must be able to sign in
    '/auth/', // sign-in pages
    '/api/webhooks/', // Stripe / EasyPost — external, signature-verified
    '/api/cron/', // Vercel cron — external, Bearer CRON_SECRET
];

export function isAllowlisted(pathname: string): boolean {
    return ALLOWLIST_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Is the lock active right now?
 *
 * Default LOCKED: the gate is on unless LAUNCH_LOCKED is an explicit falsy
 * value (0/false/no/off). A missing var means locked — a fresh deploy without
 * the var set stays private rather than accidentally going public.
 *
 * Safety valve: if locked but no LAUNCH_PASSWORD is set, fail OPEN and warn.
 * Otherwise we'd render a form no password can satisfy and lock everyone out
 * (including admins who haven't signed in yet), with no way back in.
 */
export function isLaunchLockEnabled(): boolean {
    const flag = process.env.LAUNCH_LOCKED;
    const explicitlyOff = /^(0|false|no|off)$/i.test((flag || '').trim());
    if (explicitlyOff) return false;

    if (!process.env.LAUNCH_PASSWORD) {
        console.warn(
            '[launchLock] LAUNCH_LOCKED is on but LAUNCH_PASSWORD is empty — failing open (site NOT locked). Set LAUNCH_PASSWORD to enable the lock.',
        );
        return false;
    }
    return true;
}

function secret(): string {
    // NEXTAUTH_SECRET is required app-wide (authOptions throws without it), so
    // this is always present in any real deploy.
    return process.env.NEXTAUTH_SECRET || '';
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    return new Uint8Array(sig);
}

function toBase64Url(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    // btoa exists in both the Edge runtime and Node 18+.
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Length-safe, timing-safe equality for two byte arrays. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * The value the unlock cookie should hold: an HMAC over a fixed, versioned
 * string. It carries no user input and no secret — it's just a token only the
 * server can mint (needs NEXTAUTH_SECRET) and re-verify.
 */
export async function expectedCookieValue(): Promise<string> {
    const mac = await hmac(secret(), `launch-unlock:${COOKIE_VERSION}`);
    return toBase64Url(mac);
}

/** Constant-time check of a cookie value presented by the browser. */
export async function isValidCookie(value: string | undefined): Promise<boolean> {
    if (!value) return false;
    const expected = await expectedCookieValue();
    const enc = new TextEncoder();
    return constantTimeEqual(enc.encode(value), enc.encode(expected));
}

/**
 * Verify a submitted password against LAUNCH_PASSWORD. Both sides are HMAC'd
 * first so the compared buffers are always 32 bytes regardless of input length
 * — a wrong-length guess leaks nothing through timing.
 */
export async function verifyPassword(input: string): Promise<boolean> {
    const expected = process.env.LAUNCH_PASSWORD;
    if (!expected) return false;
    const [a, b] = await Promise.all([
        hmac(secret(), `pw:${input}`),
        hmac(secret(), `pw:${expected}`),
    ]);
    return constantTimeEqual(a, b);
}
