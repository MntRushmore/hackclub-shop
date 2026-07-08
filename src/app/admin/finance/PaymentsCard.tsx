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
    testConfigured: boolean; testReachable: boolean; testWebhookConfigured: boolean;
}
type Mode = 'live' | 'test';
interface ModeState { global: Mode; personal: Mode | null; effective: Mode }
interface HcbUser { id?: string; name?: string; email?: string }
interface HcbStatus { loading: boolean; configured: boolean; connected: boolean; user: HcbUser | null }

const STRIPE_EMPTY: StripeStatus = { loading: true, configured: false, reachable: false, livemode: false, taxEnabled: false, webhookConfigured: false, account: null, testConfigured: false, testReachable: false, testWebhookConfigured: false };
const HCB_EMPTY: HcbStatus = { loading: true, configured: false, connected: false, user: null };

export default function PaymentsCard() {
    const [stripe, setStripe] = useState<StripeStatus>(STRIPE_EMPTY);
    const [mode, setMode] = useState<ModeState | null>(null);
    const [modeError, setModeError] = useState<string | null>(null);
    const [modeBusy, setModeBusy] = useState(false);
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
                    testConfigured: Boolean(data.test?.configured),
                    testReachable: Boolean(data.test?.reachable),
                    testWebhookConfigured: Boolean(data.test?.webhookConfigured),
                });
                if (data.mode) setMode(data.mode as ModeState);
            } catch {
                setStripe({ ...STRIPE_EMPTY, loading: false });
            }
        })();
    }, []);

    const changeMode = async (scope: 'global' | 'personal', next: Mode | null) => {
        if (modeBusy) return;
        setModeBusy(true);
        setModeError(null);
        try {
            const res = await fetch('/api/admin/stripe/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope, mode: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setModeError(data.error || 'Could not change the mode.');
                return;
            }
            setMode({ global: data.global, personal: data.personal, effective: data.effective });
        } catch {
            setModeError('Could not change the mode.');
        } finally {
            setModeBusy(false);
        }
    };

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

            {/* ── Checkout mode: which key slot charges cards (live vs test) ── */}
            {stripe.configured && mode && (
                <div className="mt-4 pt-4 border-t border-hackclub-smoke">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p className="font-bold text-hackclub-dark text-sm flex items-center gap-2">
                                Checkout mode
                                <Badge tone={mode.effective === 'live' ? 'green' : 'orange'}>
                                    {mode.effective === 'live' ? 'You checkout in Live' : 'You checkout in Test'}
                                </Badge>
                            </p>
                            <p className="text-sm text-hackclub-slate max-w-xl">
                                {!stripe.testConfigured
                                    ? 'Set STRIPE_SECRET_KEY_TEST (and STRIPE_WEBHOOK_SECRET_TEST) to unlock test-mode checkouts with Stripe test cards.'
                                    : mode.global === 'test'
                                        ? 'The whole store is in test mode. Guests cannot be charged real money until this is switched back to Live.'
                                        : 'Everyone checks out in live mode. Use the personal override to run test-card checkouts without affecting customers.'}
                            </p>
                            {modeError && <p className="text-sm text-hackclub-red mt-1">{modeError}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-hackclub-muted uppercase tracking-wide">Everyone</span>
                                <Segmented
                                    value={mode.global}
                                    disabled={modeBusy || !stripe.testConfigured}
                                    options={[
                                        { value: 'live', label: 'Live' },
                                        { value: 'test', label: 'Test' },
                                    ]}
                                    onChange={(v) => changeMode('global', v as Mode)}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-hackclub-muted uppercase tracking-wide">Just me</span>
                                <Segmented
                                    value={mode.personal ?? 'follow'}
                                    disabled={modeBusy}
                                    options={[
                                        { value: 'follow', label: 'Follow store' },
                                        { value: 'live', label: 'Live', disabled: false },
                                        { value: 'test', label: 'Test', disabled: !stripe.testConfigured },
                                    ]}
                                    onChange={(v) => changeMode('personal', v === 'follow' ? null : (v as Mode))}
                                />
                            </div>
                        </div>
                    </div>
                    {stripe.testConfigured && !stripe.testWebhookConfigured && (
                        <p className="text-sm text-hackclub-orange mt-2">
                            STRIPE_WEBHOOK_SECRET_TEST is not set. Test payments will succeed on Stripe but the orders will stay unpaid, since the webhook is the only trusted paid signal.
                        </p>
                    )}
                    {stripe.testConfigured && !stripe.testReachable && (
                        <p className="text-sm text-hackclub-red mt-2">
                            The test key is set but Stripe rejected it. Test-mode checkout is down until STRIPE_SECRET_KEY_TEST is fixed.
                        </p>
                    )}
                </div>
            )}

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

function Segmented({ value, options, onChange, disabled }: {
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className="inline-flex rounded-full border-2 border-hackclub-smoke overflow-hidden" role="group">
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        disabled={disabled || opt.disabled}
                        aria-pressed={active}
                        onClick={() => !active && onChange(opt.value)}
                        className={`px-3 py-1 text-xs font-bold transition-colors disabled:opacity-50 ${
                            active
                                ? opt.value === 'test'
                                    ? 'bg-hackclub-orange text-white'
                                    : 'bg-hackclub-dark text-white'
                                : 'bg-white text-hackclub-slate hover:bg-hackclub-snow'
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
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
