import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DEFAULT_API_BASE = 'https://hcb.hackclub.com/api/v4';
const DEFAULT_DONATE_HOST = 'https://hcb.hackclub.com';

function apiBase(): string {
    return (process.env.HCB_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
}

/** True only when everything needed for BOTH the donate URL and the read-back is present. */
export function isHcbConfigured(): boolean {
    return Boolean(
        process.env.HCB_ORG_ID &&
        process.env.HCB_ORG_SLUG &&
        process.env.HCB_CLIENT_ID &&
        process.env.HCB_CLIENT_SECRET,
    );
}

export function buildDonationUrl(opts: { amountUsd: number; email?: string; name?: string; orderId: string }): string {
    const slug = process.env.HCB_ORG_SLUG || '';
    // Prefer an explicit donate base if provided (lets prod/staging differ from the API host).
    const base = (process.env.NEXT_PUBLIC_HCB_DONATE_BASE || `${DEFAULT_DONATE_HOST}/donations/start/${slug}`).replace(/\/+$/, '');
    const params = new URLSearchParams();
    // Dollars → integer cents, which is what the donation-start form expects.
    params.set('amount', String(Math.round(opts.amountUsd * 100)));
    if (opts.email) params.set('email', opts.email);
    if (opts.name) params.set('name', opts.name);
    params.set('utm_source', 'shop');
    params.set('utm_content', opts.orderId);
    return `${base}?${params.toString()}`;
}

const REDIS_REFRESH_KEY = 'hcb:oauth:refresh_token';
const REDIS_RET = 60 * 60 * 24 * 365; 
let _access: { value: string; expiresAt: number } | null = null;
function redirectUri(): string {
    const origin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${origin}/hcb/callback`;
}

export function buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
        client_id: process.env.HCB_CLIENT_ID || '',
        redirect_uri: redirectUri(),
        response_type: 'code',
        state,
    });
    // Send NO scope param by default — let HCB use the app's own default grant
    // (avoids invalid_scope from mismatched scope strings). HCB_OAUTH_SCOPE can
    // set an explicit space-separated scope if ever needed.
    const scope = process.env.HCB_OAUTH_SCOPE;
    if (scope && scope.trim()) params.set('scope', scope.trim());
    return `${apiBase()}/oauth/authorize?${params.toString()}`;
}

/** True once an admin has connected HCB (a refresh token is stored). */
export async function isHcbConnected(): Promise<boolean> {
    try {
        return Boolean(await redis.get<string>(REDIS_REFRESH_KEY));
    } catch {
        return false;
    }
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse | null> {
    try {
        const form = new URLSearchParams(body);
        const res = await fetch(`${apiBase()}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
            redirect: 'manual',
        });
        const text = await res.text();
        let data: TokenResponse;
        try {
            data = JSON.parse(text) as TokenResponse;
        } catch {
            console.error('[hcb] token endpoint returned non-JSON:', res.status, text.slice(0, 200));
            return null;
        }
        if (!res.ok || data.error) {
            console.error('[hcb] token request failed:', res.status, data.error, data.error_description);
            return null;
        }
        return data;
    } catch (err) {
        console.error('[hcb] token request error:', err instanceof Error ? err.message : err);
        return null;
    }
}

/**
 * Exchange an authorization code (from the /hcb/callback OAuth return) for an
 * access + refresh token, and persist the refresh token. Returns true on
 * success. Called once, by the admin connect flow.
 */
export async function exchangeCodeForTokens(code: string): Promise<boolean> {
    if (!isHcbConfigured()) return false;
    const data = await postToken({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.HCB_CLIENT_ID || '',
        client_secret: process.env.HCB_CLIENT_SECRET || '',
        redirect_uri: redirectUri(),
    });
    if (!data?.access_token || !data.refresh_token) {
        console.error('[hcb] code exchange missing tokens');
        return false;
    }
    try {
        await redis.set(REDIS_REFRESH_KEY, data.refresh_token, { ex: REDIS_RET });
    } catch (err) {
        console.error('[hcb] failed to persist refresh token:', err instanceof Error ? err.message : err);
        return false;
    }
    _access = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 - 60_000 };
    return true;
}

/** Drop the stored connection (admin disconnect). */
export async function clearHcbConnection(): Promise<void> {
    _access = null;
    try {
        await redis.del(REDIS_REFRESH_KEY);
    } catch {
        // best-effort
    }
}

/**
 * Get a valid access token, minting a fresh one from the stored refresh token
 * when the cached one is missing/expired (or forceRefresh is set). Returns null
 * when HCB isn't connected or the refresh fails — callers degrade to "couldn't
 * reconcile yet" rather than throw.
 */
async function getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!isHcbConfigured()) return null;
    if (!forceRefresh && _access && _access.expiresAt > Date.now()) return _access.value;

    let refreshToken: string | null;
    try {
        refreshToken = await redis.get<string>(REDIS_REFRESH_KEY);
    } catch (err) {
        console.error('[hcb] failed to read refresh token:', err instanceof Error ? err.message : err);
        return null;
    }
    if (!refreshToken) {
        // Not connected yet — an admin must authorize the app once.
        return null;
    }

    const data = await postToken({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.HCB_CLIENT_ID || '',
        client_secret: process.env.HCB_CLIENT_SECRET || '',
    });
    if (!data?.access_token) return null;

    // Doorkeeper rotates refresh tokens — persist the new one if returned.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
        try {
            await redis.set(REDIS_REFRESH_KEY, data.refresh_token, { ex: REDIS_RET });
        } catch {
            // best-effort; the access token is still usable now
        }
    }
    _access = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 - 60_000 };
    return _access.value;
}

// ── Connected identity (diagnostics) ─────────────────────────────────────────

export interface HcbUser {
    id?: string;
    name?: string;
    email?: string;
    admin?: boolean;
}

/**
 * Who the stored token authenticates as on HCB (`GET /api/v4/user`). Used by the
 * admin dashboard to show which HCB account is connected — important because a
 * `403 not_authorized` reading the org's transactions usually means this user
 * isn't an organizer on that org. Returns null when not connected / unreachable.
 */
export async function getConnectedHcbUser(): Promise<HcbUser | null> {
    const token = await getAccessToken();
    if (!token) return null;
    try {
        const res = await fetch(`${apiBase()}/user`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            cache: 'no-store',
        });
        if (!res.ok) {
            console.error('[hcb] /user request failed:', res.status, (await res.text()).slice(0, 200));
            return null;
        }
        const data = (await res.json()) as HcbUser;
        return { id: data.id, name: data.name, email: data.email, admin: data.admin };
    } catch (err) {
        console.error('[hcb] /user request error:', err instanceof Error ? err.message : err);
        return null;
    }
}

// ── Transactions (reconciliation) ────────────────────────────────────────────

/** A donation as surfaced on a v4 transaction (only the fields we rely on). */
interface HcbDonation {
    name?: string;
    email?: string;
    message?: string;
    donated_at?: string;
    refunded?: boolean;
    utm_source?: string;
    utm_content?: string;
}

/** A v4 transaction (only the fields we rely on). */
interface HcbTransaction {
    id?: string;
    date?: string;
    amount_cents?: number;
    memo?: string;
    pending?: boolean;
    declined?: boolean;
    donation?: HcbDonation | null;
}

/**
 * Fetch the org's transactions. Auto-refreshes the token once on a 401. Returns
 * null on any failure so callers can treat it as "not reconciled yet".
 */
async function listOrgTransactions(): Promise<HcbTransaction[] | null> {
    const orgId = process.env.HCB_ORG_ID;
    if (!orgId) return null;

    const fetchWith = async (token: string) =>
        fetch(`${apiBase()}/organizations/${encodeURIComponent(orgId)}/transactions`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            cache: 'no-store',
        });

    try {
        let token = await getAccessToken();
        if (!token) return null;
        let res = await fetchWith(token);
        if (res.status === 401) {
            // Token may have been revoked/expired early — refresh once and retry.
            token = await getAccessToken(true);
            if (!token) return null;
            res = await fetchWith(token);
        }
        if (!res.ok) {
            console.error('[hcb] transactions request failed:', res.status, (await res.text()).slice(0, 200));
            return null;
        }
        const data = await res.json();
        // The v4 index may return a bare array or a wrapped object; handle both.
        const list = Array.isArray(data) ? data : (data?.transactions ?? data?.data ?? []);
        return Array.isArray(list) ? (list as HcbTransaction[]) : [];
    } catch (err) {
        console.error('[hcb] transactions request error:', err instanceof Error ? err.message : err);
        return null;
    }
}

/** The matched donation, returned to the reconciler so it can record the linkage. */
export interface MatchedDonation {
    txId: string;
    donatedAt?: string;
}

/**
 * Find the settled donation that pays for `orderId`. Matching is keyed on the
 * `utm_content` tag we embedded in the donation URL (deterministic, collision-
 * free); the expected amount is verified as a secondary guard so a tampered or
 * underpaid donation isn't accepted. Pending, declined, and refunded donations
 * are ignored.
 *
 * Returns:
 *   - a MatchedDonation when a valid donation is found,
 *   - null when none matches yet (still waiting on the donor),
 *   - 'unavailable' when HCB couldn't be reached/authed (transient — keep polling).
 */
export async function findDonationForOrder(
    orderId: string,
    expected: { amountCents: number; email?: string },
): Promise<MatchedDonation | null | 'unavailable'> {
    const txns = await listOrgTransactions();
    if (txns === null) return 'unavailable';

    for (const tx of txns) {
        const d = tx.donation;
        if (!d) continue;
        if (tx.pending || tx.declined || d.refunded) continue;
        if (d.utm_content !== orderId) continue;

        // Secondary guard: the donated amount must cover the order total. HCB
        // donations are positive credits; allow a tiny rounding slack and accept
        // anything >= expected (a donor may have opted to cover fees).
        const amt = typeof tx.amount_cents === 'number' ? Math.abs(tx.amount_cents) : 0;
        if (amt + 1 < expected.amountCents) {
            console.error(`[hcb] donation for ${orderId} underpays: ${amt} < ${expected.amountCents}`);
            continue;
        }

        return { txId: tx.id || '', donatedAt: d.donated_at };
    }
    return null;
}
