'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ShippingAddress } from '../../types/Order';
import { formatCash } from '../../lib/paymentUtils';

export interface SelectedRate {
    rateId: string;
    shipmentId: string;
    cost: number;
    label: string;
}

interface RateOption {
    id: string;
    shipmentId?: string;
    carrier: string;
    service: string;
    cost: number;
    estDeliveryDays?: number;
}

/**
 * Guest checkout shipping picker. Fetches live EasyPost rates for the cart +
 * destination and lets the customer choose a speed (and pay for it). Falls back
 * to the flat per-country rate when EasyPost isn't configured (single option,
 * preselected). Reports the choice up via onSelect so checkout can pass it to
 * Stripe and gate the pay button until a rate is chosen.
 */
export default function LiveShippingRates({
    items,
    checkoutData,
    shippingCountry,
    onSelect,
}: {
    items: { id: string; variant_id?: string | number; quantity: number }[];
    checkoutData: Record<string, string | ShippingAddress>;
    shippingCountry?: string;
    onSelect: (rate: SelectedRate | null) => void;
}) {
    const [options, setOptions] = useState<RateOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needsAddress, setNeedsAddress] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const reqSeq = useRef(0);

    // Build a stable signature of the inputs that affect rates, so we refetch when
    // the address or cart changes but not on unrelated re-renders.
    const addr = Object.values(checkoutData).find(
        (v): v is ShippingAddress => typeof v === 'object' && v !== null && 'line1' in v,
    );
    const sig = JSON.stringify({
        items: items.map((i) => [i.id, i.variant_id, i.quantity]),
        addr: addr ? [addr.line1, addr.city, addr.state, addr.postal_code, addr.country] : null,
        country: shippingCountry,
    });

    // Debounce the signature so typing an address doesn't fire a rate request
    // (a billable EasyPost call, rate-limited 20/min) on every keystroke.
    const [debouncedSig, setDebouncedSig] = useState(sig);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSig(sig), 500);
        return () => clearTimeout(t);
    }, [sig]);

    useEffect(() => {
        const seq = ++reqSeq.current;
        setLoading(true);
        setError(null);
        setNeedsAddress(false);
        onSelect(null);
        setSelectedId(null);

        (async () => {
            try {
                const res = await fetch('/api/checkout/shipping-rates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items, checkoutData, shippingCountry }),
                });
                const data = await res.json();
                if (seq !== reqSeq.current) return; // a newer request superseded this one
                if (data.needsAddress) {
                    setNeedsAddress(true);
                    setOptions([]);
                    return;
                }
                if (!res.ok || data.error) {
                    setError(data.error || 'Could not load shipping options.');
                    setOptions([]);
                    return;
                }
                const opts: RateOption[] = data.options || [];
                setOptions(opts);
                // Auto-select the cheapest (first) so a valid default is always set.
                if (opts.length > 0) {
                    const first = opts[0];
                    setSelectedId(first.id);
                    onSelect({
                        rateId: first.id,
                        shipmentId: first.shipmentId || '',
                        cost: first.cost,
                        label: `${first.carrier} ${first.service}`.trim(),
                    });
                }
            } catch {
                if (seq === reqSeq.current) setError('Could not load shipping options.');
            } finally {
                if (seq === reqSeq.current) setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSig]);

    const choose = (o: RateOption) => {
        setSelectedId(o.id);
        onSelect({
            rateId: o.id,
            shipmentId: o.shipmentId || '',
            cost: o.cost,
            label: `${o.carrier} ${o.service}`.trim(),
        });
    };

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-3">
            <label className="block font-bold text-hackclub-dark">Shipping speed</label>

            {needsAddress ? (
                <p className="text-sm text-hackclub-muted">Enter your shipping address above to see shipping options.</p>
            ) : loading ? (
                <div className="flex items-center gap-2 text-hackclub-muted text-sm font-bold py-2">
                    <span className="inline-block w-4 h-4 border-2 border-hackclub-muted/40 border-t-hackclub-muted rounded-full animate-spin" />
                    Loading shipping options…
                </div>
            ) : error ? (
                <p className="text-sm text-hackclub-red font-bold">{error}</p>
            ) : options.length === 0 ? (
                <p className="text-sm text-hackclub-muted">No shipping options available for this address.</p>
            ) : (
                <div className="space-y-2">
                    {options.map((o) => {
                        const active = selectedId === o.id;
                        return (
                            <button
                                key={o.id}
                                type="button"
                                onClick={() => choose(o)}
                                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 text-left transition-colors ${active ? 'border-hackclub-red bg-hackclub-red/5' : 'border-hackclub-smoke bg-white hover:border-hackclub-slate'}`}
                                aria-pressed={active}
                            >
                                <span className="flex items-center gap-3">
                                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${active ? 'border-hackclub-red bg-hackclub-red' : 'border-hackclub-muted'}`} />
                                    <span>
                                        <span className="block font-bold text-hackclub-dark text-sm">{o.carrier} {o.service}</span>
                                        {o.estDeliveryDays != null && (
                                            <span className="block text-xs text-hackclub-muted">~{o.estDeliveryDays} business day{o.estDeliveryDays === 1 ? '' : 's'}</span>
                                        )}
                                    </span>
                                </span>
                                <span className="font-black text-hackclub-dark">{o.cost > 0 ? formatCash(o.cost) : 'Free'}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </motion.div>
    );
}
