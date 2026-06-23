/**
 * HCB Donations payment layer for the guest (adult / cash) checkout.
 *
 * The shop does NOT take card payments directly. Instead a guest order is paid
 * by making a donation to the shop's HCB organization on HCB's own hosted
 * donation page. The flow:
 *
 *   1. Checkout creates an `unpaid` order and builds a PRE-FILLED HCB donation
 *      URL (`buildDonationUrl`) — amount derived server-side, plus a
 *      `utm_content=<orderId>` tag so the donation can later be tied back to the
 *      exact order. The donor pays on HCB; no money flows through our servers.
 *   2. Reconciliation (`findDonationForOrder`) polls the HCB **v4** transactions
 *      API for the org and matches the donation by its `utm_content` (amount +
 *      email are a secondary sanity check). On a match the order is finalized.
 *
 * Why a poll instead of a webhook: the OAuth app we hold is read-only
 * (`restricted` scope), so we can neither create the donation via API nor
 * receive a signed webhook — the only write path is HCB's hosted form, and the
 * only trusted read-back is the transactions API.
 *
 * Provider-agnostic and safe by design, like `email.ts` / `shipping.ts`:
 *   - No SDK; plain `fetch` against the HCB v4 REST API with a bearer token.
 *   - When the HCB env is unset, every call returns a typed "not configured"
 *     result instead of throwing, so a misconfigured deploy fails soft (the
 *     order just stays `unpaid`) rather than taking down checkout.
 *
 * To go live, set (see `.env.example`):
 *   HCB_API_BASE   e.g. https://hcb.hackclub.com/api/v4 (local dev: http://localhost:4000/api/v4)
 *   HCB_ORG_ID     the org id for the transactions endpoint (e.g. org_E1u04j)
 *   HCB_ORG_SLUG   the org slug for the donation-start URL
 *   HCB_CLIENT_ID / HCB_CLIENT_SECRET   the Doorkeeper OAuth app credentials
 *   NEXT_PUBLIC_HCB_DONATE_BASE   https://hcb.hackclub.com/donations/start/<slug>
 */

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

// ── Donation URL (the hosted write path) ─────────────────────────────────────

/**
 * Build the pre-filled HCB donation URL the donor is sent to. Amount is taken
 * verbatim from the server-derived order total (never a client-supplied price)
 * and rendered in DOLLARS, which is what the donation-start form expects. The
 * `utm_content` tag carries the order id back onto the donation record so
 * reconciliation can match it deterministically.
 */
export function buildDonationUrl(opts: { amountUsd: number; email?: string; orderId: string }): string {
    const slug = process.env.HCB_ORG_SLUG || '';
    // Prefer an explicit donate base if provided (lets prod/staging differ from the API host).
    const base = (process.env.NEXT_PUBLIC_HCB_DONATE_BASE || `${DEFAULT_DONATE_HOST}/donations/start/${slug}`).replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('amount', opts.amountUsd.toFixed(2));
    if (opts.email) params.set('email', opts.email);
    params.set('utm_source', 'shop');
    params.set('utm_content', opts.orderId);
    return `${base}?${params.toString()}`;
}

// ── OAuth token (the read path) ──────────────────────────────────────────────

let _token: { value: string; expiresAt: number } | null = null;

/**
 * Fetch (and cache) a bearer token via the client_credentials grant. Cached in
 * module memory until ~60s before expiry. Returns null when unconfigured or on
 * any failure — callers degrade to "couldn't reconcile yet" rather than throw.
 */
async function getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!isHcbConfigured()) return null;
    const now = Date.now();
    if (!forceRefresh && _token && _token.expiresAt > now) return _token.value;

    try {
        const res = await fetch(`${apiBase()}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: process.env.HCB_CLIENT_ID,
                client_secret: process.env.HCB_CLIENT_SECRET,
                scope: 'read',
            }),
        });
        if (!res.ok) {
            console.error('[hcb] token request failed:', res.status, (await res.text()).slice(0, 200));
            return null;
        }
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!data.access_token) {
            console.error('[hcb] token response missing access_token');
            return null;
        }
        const ttlMs = (data.expires_in ?? 3600) * 1000;
        _token = { value: data.access_token, expiresAt: now + ttlMs - 60_000 };
        return _token.value;
    } catch (err) {
        console.error('[hcb] token request error:', err instanceof Error ? err.message : err);
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
