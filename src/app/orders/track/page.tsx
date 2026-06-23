'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface LookupItem {
    name: string;
    quantity: number;
    price: string;
    thumbnail_url?: string;
}
interface LookupShipment {
    carrier?: string;
    service?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    estDeliveryDate?: string;
}
interface LookupOrder {
    id: string;
    ref: string;
    status: string;
    paymentStatus: string;
    createdAt: string;
    items: LookupItem[];
    totalAmount: number;
    shippingAddress?: { city: string; state: string; country: string };
    shipment?: LookupShipment;
    statusHistory: { status: string; timestamp: string; message?: string }[];
}

const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    fulfilled: 'bg-green-100 text-green-800',
    denied: 'bg-red-100 text-red-800',
    refunded: 'bg-orange-100 text-orange-800',
};

const gridBg = {
    backgroundImage:
        'linear-gradient(to right, #e0f2fe 1px, transparent 1px), linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)',
    backgroundSize: '30px 30px',
};

const TrackInner = () => {
    const params = useSearchParams();
    const [email, setEmail] = useState(params.get('email') || '');
    const [orderRef, setOrderRef] = useState(params.get('ref') || '');
    const [order, setOrder] = useState<LookupOrder | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lookup = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!email.trim() || !orderRef.trim()) {
            setError('Enter your email and order number.');
            return;
        }
        setLoading(true);
        setError(null);
        setOrder(null);
        try {
            const res = await fetch('/api/orders/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), orderRef: orderRef.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Lookup failed.');
                return;
            }
            setOrder(data.order);
        } catch {
            setError('Lookup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Auto-run the lookup if the email link prefilled both fields.
    useEffect(() => {
        if (params.get('email') && params.get('ref')) {
            lookup();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen bg-white text-hackclub-dark" style={gridBg}>
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <h1 className="text-4xl sm:text-5xl font-black text-hackclub-dark mb-2">Track your order</h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-8">
                        Enter the email and order number from your confirmation email.
                    </p>

                    <form onSubmit={lookup} className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 space-y-4">
                        <div>
                            <label htmlFor="track-email" className="block text-sm font-bold text-hackclub-slate mb-1">Email</label>
                            <input
                                id="track-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full rounded-xl border-2 border-hackclub-smoke px-4 py-2.5 focus:border-hackclub-blue focus:outline-none"
                            />
                        </div>
                        <div>
                            <label htmlFor="track-ref" className="block text-sm font-bold text-hackclub-slate mb-1">Order number</label>
                            <input
                                id="track-ref"
                                value={orderRef}
                                onChange={(e) => setOrderRef(e.target.value)}
                                placeholder="e.g. 1a2b3c4d"
                                className="w-full rounded-xl border-2 border-hackclub-smoke px-4 py-2.5 font-mono focus:border-hackclub-blue focus:outline-none"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 rounded-full transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Looking up…' : 'Find my order'}
                        </button>
                    </form>

                    {error && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red/30 rounded-xl text-center">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    {order && (
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-6 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden"
                        >
                            <div className="px-6 py-4 border-b-2 border-hackclub-smoke flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-hackclub-muted font-bold">Order #{order.ref}</p>
                                    <p className="text-xs text-hackclub-slate">{new Date(order.createdAt).toLocaleDateString()}</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS_COLOR[order.status] || 'bg-gray-100 text-gray-800'}`}>
                                    {order.status}
                                </span>
                            </div>

                            <div className="px-6 py-4 space-y-3">
                                {order.items.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <span className="font-bold text-hackclub-dark">{item.quantity}× {item.name}</span>
                                        <span className="text-hackclub-slate">${(parseFloat(item.price) * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between pt-2 border-t border-hackclub-smoke">
                                    <span className="font-bold text-hackclub-slate">Total</span>
                                    <span className="font-black text-hackclub-dark">${order.totalAmount.toFixed(2)}</span>
                                </div>
                            </div>

                            {order.shipment?.trackingNumber && (
                                <div className="px-6 py-4 border-t-2 border-hackclub-smoke">
                                    <div className="rounded-xl bg-hackclub-snow border-2 border-hackclub-smoke px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-bold text-hackclub-muted uppercase">
                                                📦 Shipped{order.shipment.carrier ? ` · ${order.shipment.carrier}${order.shipment.service ? ` ${order.shipment.service}` : ''}` : ''}
                                            </p>
                                            <p className="font-mono text-sm text-hackclub-dark">{order.shipment.trackingNumber}</p>
                                            {order.shipment.estDeliveryDate && (
                                                <p className="text-xs text-hackclub-slate mt-0.5">Est. delivery: {order.shipment.estDeliveryDate}</p>
                                            )}
                                        </div>
                                        {order.shipment.trackingUrl && (
                                            <a
                                                href={order.shipment.trackingUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="bg-hackclub-red hover:bg-hackclub-orange text-white font-bold text-sm py-2 px-4 rounded-full transition-colors whitespace-nowrap"
                                            >
                                                Track package →
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    <p className="text-center text-sm text-hackclub-muted mt-8">
                        Signed in with Hack Club?{' '}
                        <Link href="/orders" className="text-hackclub-blue font-bold hover:underline">See all your orders</Link>
                    </p>
                </motion.div>
            </div>
        </div>
    );
};

const TrackPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-hackclub-dark font-bold">Loading…</div>}>
        <TrackInner />
    </Suspense>
);

export default TrackPage;
