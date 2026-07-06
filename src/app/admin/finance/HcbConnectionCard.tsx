'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui';

/**
 * Admin card for the HCB Donations connection. Guest checkout is paid by a
 * donation on HCB; the shop reconciles those donations by reading the HCB v4
 * transactions API. That read requires a token from a one-time OAuth connect
 * (the HCB app can't do machine-to-machine auth), so an admin authorizes the
 * app once here. Until connected, guest HCB orders can't auto-reconcile.
 */
interface HcbUser { id?: string; name?: string; email?: string; admin?: boolean }
type Status = { loading: boolean; configured: boolean; connected: boolean; user: HcbUser | null };

export default function HcbConnectionCard() {
    const [status, setStatus] = useState<Status>({ loading: true, configured: false, connected: false, user: null });
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/hcb/status');
            if (!res.ok) {
                setStatus({ loading: false, configured: false, connected: false, user: null });
                return;
            }
            const data = await res.json();
            setStatus({
                loading: false,
                configured: Boolean(data.configured),
                connected: Boolean(data.connected),
                user: data.user ?? null,
            });
        } catch {
            setStatus({ loading: false, configured: false, connected: false, user: null });
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const disconnect = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await fetch('/api/admin/hcb/status', { method: 'DELETE' });
            await load();
        } finally {
            setBusy(false);
        }
    };

    if (status.loading) return null;

    const dot = status.connected ? 'bg-green-500' : status.configured ? 'bg-hackclub-orange' : 'bg-hackclub-muted';
    const label = status.connected ? 'Connected' : status.configured ? 'Not connected' : 'Not configured';

    return (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
                <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${dot}`} aria-hidden="true" />
                <div>
                    <p className="font-black text-hackclub-dark">HCB Donations — {label}</p>
                    <p className="text-sm text-hackclub-slate max-w-xl">
                        {!status.configured
                            ? 'Set the HCB_* environment variables to enable guest donation checkout.'
                            : status.connected
                                ? 'Guest donations reconcile automatically. Reconnect if reads start failing.'
                                : 'Authorize the shop with HCB once so guest donations can be matched to orders. Guest orders stay unpaid until this is connected.'}
                    </p>
                    {status.connected && (
                        status.user ? (
                            <p className="text-sm text-hackclub-dark mt-2">
                                Signed in to HCB as <span className="font-bold">{status.user.name || status.user.email || status.user.id || 'unknown'}</span>
                                {status.user.email && status.user.name ? <span className="text-hackclub-slate"> ({status.user.email})</span> : null}
                                {status.user.admin ? <span className="ml-2 px-2 py-0.5 rounded-full bg-hackclub-blue/10 text-hackclub-blue text-xs font-bold align-middle">HCB admin</span> : null}
                            </p>
                        ) : (
                            <p className="text-sm text-hackclub-red font-bold mt-2">
                                Connected, but couldn&apos;t read the HCB account — the token may lack access to this org. Reconnect with an HCB account that&apos;s an organizer on the shop org.
                            </p>
                        )
                    )}
                </div>
            </div>
            {status.configured && (
                <div className="flex gap-2">
                    {/* A full-page nav (not fetch) — the connect route 302s to HCB's login/consent. */}
                    <a
                        href="/api/admin/hcb/connect"
                        className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-6 py-2.5 rounded-full transition-colors"
                    >
                        {status.connected ? 'Reconnect' : 'Connect HCB'}
                    </a>
                    {status.connected && (
                        <button
                            type="button"
                            onClick={disconnect}
                            disabled={busy}
                            className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-6 py-2.5 rounded-full transition-colors disabled:opacity-50"
                        >
                            Disconnect
                        </button>
                    )}
                </div>
            )}
        </Card>
    );
}
