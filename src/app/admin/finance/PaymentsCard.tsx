'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui';

/**
 * Admin card for the payment stack. Stripe is the guest checkout processor
 * (Checkout Sessions + webhook finalization, Stripe Tax when enabled), so it
 * gets the primary row: key health, mode, tax, and the webhook secret that the
 * paid signal depends on. HCB is legacy: guest checkout ran on HCB donations
 * before 2026-06-24, and the connection is kept only so those old orders can
 * still reconcile. The HCB row hides itself once HCB is fully unconfigured.
 */

interface StripeAccount { id: string; name: string | null; email: string | null }
interface StripeStatus {
    loading: boolean; configured: boolean; reachable: boolean; livemode: boolean;
    taxEnabled: boolean; webhookConfigured: boolean; account: StripeAccount | null;
}
interface HcbUser { id?: string; name?: string; email?: string }
interface HcbStatus { loading: boolean; configured: boolean; connected: boolean; user: HcbUser | null }

const STRIPE_EMPTY: StripeStatus = { loading: true, configured: false, reachable: false, livemode: false, taxEnabled: false, webhookConfigured: false, account: null };
const HCB_EMPTY: HcbStatus = { loading: true, configured: false, connected: false, user: null };

export default function PaymentsCard() {
    const [stripe, setStripe] = useState<StripeStatus>(STRIPE_EMPTY);
    const [hcb, setHcb] = useState<HcbStatus>(HCB_EMPTY);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/stripe/status');
                const data = res.ok ? await res.json() : {};
                setStripe({
                    loading: false,
                    configured: Boolean(data.configured),
                    reachable: Boolean(data.reachable),
                    livemode: Boolean(data.livemode),
                    taxEnabled: Boolean(data.taxEnabled),
                    webhookConfigured: Boolean(data.webhookConfigured),
                    account: data.account ?? null,
                });
            } catch {
                setStripe({ ...STRIPE_EMPTY, loading: false });
            }
        })();
    }, []);

    const loadHcb = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/hcb/status');
            const data = res.ok ? await res.json() : {};
            setHcb({ loading: false, configured: Boolean(data.configured), connected: Boolean(data.connected), user: data.user ?? null });
        } catch {
            setHcb({ ...HCB_EMPTY, loading: false });
        }
    }, []);
    useEffect(() => { loadHcb(); }, [loadHcb]);

    const disconnectHcb = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await fetch('/api/admin/hcb/status', { method: 'DELETE' });
            await loadHcb();
        } finally {
            setBusy(false);
        }
    };

    if (stripe.loading) return null;

    // One health verdict for the row: every state an admin needs to act on.
    const health = !stripe.configured
        ? { dot: 'bg-hackclub-muted', label: 'Not configured' }
        : !stripe.reachable
            ? { dot: 'bg-hackclub-red', label: 'Key rejected' }
            : !stripe.webhookConfigured
                ? { dot: 'bg-hackclub-orange', label: 'Webhook missing' }
                : { dot: 'bg-green-500', label: 'Connected' };

    return (
        <Card className="mb-6">
            {/* ── Stripe: the live processor ── */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${health.dot}`} aria-hidden="true" />
                    <div>
                        <p className="font-black text-hackclub-dark flex items-center gap-2 flex-wrap">
                            Stripe payments: {health.label}
                            {stripe.configured && stripe.reachable && (
                                <>
                                    <Badge tone={stripe.livemode ? 'green' : 'orange'}>{stripe.livemode ? 'Live mode' : 'Test mode'}</Badge>
                                    <Badge tone={stripe.taxEnabled ? 'blue' : 'muted'}>{stripe.taxEnabled ? 'Stripe Tax on' : 'Stripe Tax off'}</Badge>
                                </>
                            )}
                        </p>
                        <p className="text-sm text-hackclub-slate max-w-xl">
                            {!stripe.configured
                                ? 'Set STRIPE_SECRET_KEY to enable guest checkout. Orders can’t be paid until Stripe is configured.'
                                : !stripe.reachable
                                    ? 'The key is set but Stripe rejected it. Check STRIPE_SECRET_KEY; checkout is down until this is fixed.'
                                    : !stripe.webhookConfigured
                                        ? 'STRIPE_WEBHOOK_SECRET is not set. Charges will succeed on Stripe but orders will stay unpaid, since the webhook is the only trusted paid signal.'
                                        : 'Guest checkout charges through Stripe Checkout and orders finalize via the webhook.'}
                        </p>
                        {stripe.account && (
                            <p className="text-sm text-hackclub-dark mt-2">
                                Connected as <span className="font-bold">{stripe.account.name || stripe.account.email || stripe.account.id}</span>
                                {stripe.account.email && stripe.account.name ? <span className="text-hackclub-slate"> ({stripe.account.email})</span> : null}
                            </p>
                        )}
                    </div>
                </div>
                {stripe.configured && (
                    <a
                        href="https://dashboard.stripe.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-6 py-2.5 rounded-full transition-colors"
                    >
                        Open Stripe Dashboard
                    </a>
                )}
            </div>

            {/* ── HCB: legacy, reconciliation of pre-migration orders only ── */}
            {!hcb.loading && hcb.configured && (
                <div className="mt-4 pt-4 border-t border-hackclub-smoke flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <span className={`mt-1.5 inline-block w-2 h-2 rounded-full ${hcb.connected ? 'bg-green-500' : 'bg-hackclub-muted'}`} aria-hidden="true" />
                        <div>
                            <p className="font-bold text-hackclub-dark text-sm flex items-center gap-2">
                                HCB Donations: {hcb.connected ? 'Connected' : 'Not connected'}
                                <Badge tone="muted">Legacy</Badge>
                            </p>
                            <p className="text-sm text-hackclub-slate max-w-xl">
                                New guest orders no longer use HCB. This connection only reconciles orders paid by HCB donation before the Stripe migration.
                                {hcb.connected && hcb.user && (
                                    <> Signed in as <span className="font-bold text-hackclub-dark">{hcb.user.name || hcb.user.email || 'unknown'}</span>.</>
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {hcb.connected ? (
                            <button
                                type="button"
                                onClick={disconnectHcb}
                                disabled={busy}
                                className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-5 py-2 rounded-full text-sm transition-colors disabled:opacity-50"
                            >
                                Disconnect
                            </button>
                        ) : (
                            /* A full-page nav (not fetch) since the connect route 302s to HCB's login/consent. */
                            <a
                                href="/api/admin/hcb/connect"
                                className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-5 py-2 rounded-full text-sm transition-colors"
                            >
                                Reconnect HCB
                            </a>
                        )}
                    </div>
                </div>
            )}
        </Card>
    );
}

function Badge({ tone, children }: { tone: 'green' | 'orange' | 'blue' | 'muted'; children: React.ReactNode }) {
    const cls = {
        green: 'bg-hackclub-green/10 text-hackclub-green',
        orange: 'bg-hackclub-orange/10 text-hackclub-orange',
        blue: 'bg-hackclub-blue/10 text-hackclub-blue',
        muted: 'bg-hackclub-snow text-hackclub-muted',
    }[tone];
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>{children}</span>;
}
