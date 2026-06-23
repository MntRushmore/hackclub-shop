'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Order } from '../../../types/Order';
import { ShippingRate } from '../../../lib/shipping';

/**
 * In-card shipping controls for an approved order: fetch EasyPost/Pirate Ship
 * rates and buy a label, or record a tracking number bought manually in Pirate
 * Ship. On success the parent gets the updated (now-fulfilled) order back.
 */
export default function ShippingPanel({
    order,
    onShipped,
    onError,
}: {
    order: Order;
    onShipped: (updated: Order) => void;
    onError: (msg: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [loadingRates, setLoadingRates] = useState(false);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [shipmentId, setShipmentId] = useState<string | null>(null);
    const [rates, setRates] = useState<ShippingRate[]>([]);
    const [buying, setBuying] = useState<string | null>(null);
    const [mode, setMode] = useState<'rates' | 'manual'>('rates');

    // Manual entry fields
    const [carrier, setCarrier] = useState('USPS');
    const [service, setService] = useState('');
    const [trackingNumber, setTrackingNumber] = useState('');

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    const fetchRates = async (e: React.MouseEvent) => {
        stop(e);
        setOpen(true);
        if (!order.shippingAddress) {
            setConfigured(false);
            setMode('manual');
            return;
        }
        setLoadingRates(true);
        onError('');
        try {
            const res = await fetch(`/api/admin/orders/${order.id}/shipping`);
            const data = await res.json();
            setConfigured(Boolean(data.configured));
            if (!data.configured) {
                setMode('manual');
            } else if (data.error) {
                onError(data.error);
                setMode('manual');
            } else {
                setShipmentId(data.shipmentId);
                setRates(data.rates || []);
                setMode('rates');
            }
        } catch {
            onError('Could not fetch shipping rates');
            setMode('manual');
        } finally {
            setLoadingRates(false);
        }
    };

    const buy = async (rate: ShippingRate, e: React.MouseEvent) => {
        stop(e);
        setBuying(rate.id);
        onError('');
        try {
            const res = await fetch(`/api/admin/orders/${order.id}/shipping`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'buy', shipmentId, rateId: rate.id }),
            });
            const data = await res.json();
            if (!res.ok) {
                onError(data.error || 'Label purchase failed');
                return;
            }
            onShipped(data.order);
            setOpen(false);
        } catch {
            onError('Label purchase failed');
        } finally {
            setBuying(null);
        }
    };

    const recordManual = async (e: React.MouseEvent) => {
        stop(e);
        if (!trackingNumber.trim()) {
            onError('Enter a tracking number');
            return;
        }
        setBuying('manual');
        onError('');
        try {
            const res = await fetch(`/api/admin/orders/${order.id}/shipping`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'manual',
                    carrier: carrier || undefined,
                    service: service || undefined,
                    trackingNumber: trackingNumber.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                onError(data.error || 'Could not save tracking');
                return;
            }
            onShipped(data.order);
            setOpen(false);
        } catch {
            onError('Could not save tracking');
        } finally {
            setBuying(null);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={fetchRates}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-hackclub-blue hover:bg-blue-600 transition-colors"
            >
                Ship &amp; fulfill
            </button>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            onClick={stop}
            className="mt-4 w-full p-4 rounded-xl border-2 border-hackclub-smoke bg-hackclub-snow"
        >
            <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-black text-hackclub-dark">Buy postage (Pirate Ship)</p>
                <button type="button" onClick={(e) => { stop(e); setOpen(false); }} className="text-hackclub-muted hover:text-hackclub-dark text-sm font-bold">
                    Close
                </button>
            </div>

            <div className="flex gap-2 mb-4">
                <button
                    type="button"
                    onClick={(e) => { stop(e); setMode('rates'); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${mode === 'rates' ? 'bg-hackclub-dark text-white border-hackclub-dark' : 'bg-white text-hackclub-slate border-hackclub-smoke'}`}
                >
                    Buy a label
                </button>
                <button
                    type="button"
                    onClick={(e) => { stop(e); setMode('manual'); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${mode === 'manual' ? 'bg-hackclub-dark text-white border-hackclub-dark' : 'bg-white text-hackclub-slate border-hackclub-smoke'}`}
                >
                    Enter tracking manually
                </button>
            </div>

            {mode === 'rates' && (
                <div>
                    {loadingRates ? (
                        <p className="text-sm text-hackclub-muted font-bold py-4">Fetching rates…</p>
                    ) : configured === false ? (
                        <p className="text-sm text-hackclub-slate py-2">
                            EasyPost isn&apos;t configured. Buy the label in Pirate Ship and paste the tracking number under
                            &ldquo;Enter tracking manually&rdquo;.
                        </p>
                    ) : rates.length === 0 ? (
                        <p className="text-sm text-hackclub-slate py-2">No rates available for this address.</p>
                    ) : (
                        <div className="space-y-2">
                            {rates.map((r) => (
                                <div key={r.id} className="flex items-center justify-between bg-white rounded-lg border-2 border-hackclub-smoke px-3 py-2">
                                    <div className="text-sm">
                                        <span className="font-bold text-hackclub-dark">{r.carrier} {r.service}</span>
                                        {r.estDeliveryDays != null && (
                                            <span className="text-hackclub-muted"> · ~{r.estDeliveryDays}d</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-black text-hackclub-dark">${r.rate.toFixed(2)}</span>
                                        <button
                                            type="button"
                                            onClick={(e) => buy(r, e)}
                                            disabled={buying !== null}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-hackclub-green hover:bg-green-600 disabled:opacity-50"
                                        >
                                            {buying === r.id ? 'Buying…' : 'Buy'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {mode === 'manual' && (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <select
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            onClick={stop}
                            className="rounded-lg border-2 border-hackclub-smoke px-3 py-2 text-sm font-bold text-hackclub-dark"
                        >
                            {['USPS', 'UPS', 'FedEx', 'DHL', 'Other'].map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <input
                            value={service}
                            onChange={(e) => setService(e.target.value)}
                            onClick={stop}
                            placeholder="Service (optional)"
                            className="flex-1 rounded-lg border-2 border-hackclub-smoke px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <input
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            onClick={stop}
                            placeholder="Tracking number"
                            className="flex-1 rounded-lg border-2 border-hackclub-smoke px-3 py-2 text-sm font-mono"
                        />
                        <button
                            type="button"
                            onClick={recordManual}
                            disabled={buying !== null}
                            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-hackclub-green hover:bg-green-600 disabled:opacity-50"
                        >
                            {buying === 'manual' ? 'Saving…' : 'Mark shipped'}
                        </button>
                    </div>
                    <p className="text-xs text-hackclub-muted">The customer gets an email with this tracking link.</p>
                </div>
            )}
        </motion.div>
    );
}
