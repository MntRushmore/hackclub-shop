'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Icon from 'supercons';

interface Counts {
    vendors: number;
    quotes: number;
    openQuotes: number;
    pos: number;
    openPos: number;
}

export default function SourcingHub() {
    const { data: session, status } = useSession();
    const [allowed, setAllowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<Counts>({ vendors: 0, quotes: 0, openQuotes: 0, pos: 0, openPos: 0 });

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/sourcing' });
        }
    }, [status]);

    useEffect(() => {
        if (!session) return;
        (async () => {
            try {
                const me = await fetch('/api/admin/me').then((r) => r.json());
                if (!me?.permissions?.canManageSourcing) {
                    setAllowed(false);
                    setLoading(false);
                    return;
                }
                setAllowed(true);
                const [v, q, p] = await Promise.all([
                    fetch('/api/admin/sourcing/vendors').then((r) => r.json()),
                    fetch('/api/admin/sourcing/quotes').then((r) => r.json()),
                    fetch('/api/admin/sourcing/pos').then((r) => r.json()),
                ]);
                const quotes = q.quotes || [];
                const purchaseOrders = p.pos || [];
                setCounts({
                    vendors: (v.vendors || []).length,
                    quotes: quotes.length,
                    openQuotes: quotes.filter((x: { status: string }) => x.status === 'open').length,
                    pos: purchaseOrders.length,
                    openPos: purchaseOrders.filter((x: { status: string }) => x.status !== 'received' && x.status !== 'cancelled').length,
                });
            } catch {
                // best-effort; leave counts at 0
            } finally {
                setLoading(false);
            }
        })();
    }, [session]);

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (session && !allowed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Access Denied</h2>
                    <p className="text-hackclub-slate mb-6">
                        You don&apos;t have permission to manage sourcing.
                    </p>
                    <Link
                        href="/admin"
                        className="inline-block w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div
            className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Sourcing</h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-12">
                        Vendors, quotes, and procurement — where merch comes from and what it costs.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <Link href="/admin/sourcing/vendors">
                            <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-blue transition-all cursor-pointer group h-full">
                                <div className="w-12 h-12 bg-hackclub-blue/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-blue/20 transition-colors">
                                    <Icon glyph="briefcase" size={24} style={{ color: 'var(--hackclub-blue, #3291FF)' }} />
                                </div>
                                <h3 className="text-xl font-black text-hackclub-dark mb-2">
                                    Vendors <span className="text-hackclub-slate">· {counts.vendors}</span>
                                </h3>
                                <p className="text-hackclub-slate text-sm">
                                    Suppliers you source merch from — contacts, links, tags.
                                </p>
                            </div>
                        </Link>

                        <Link href="/admin/sourcing/quotes">
                            <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-green transition-all cursor-pointer group h-full">
                                <div className="w-12 h-12 bg-hackclub-green/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-green/20 transition-colors">
                                    <Icon glyph="payment" size={24} style={{ color: 'var(--hackclub-green, #33d6a6)' }} />
                                </div>
                                <h3 className="text-xl font-black text-hackclub-dark mb-2">
                                    Quotes{' '}
                                    <span className="text-hackclub-slate">
                                        · {counts.quotes} ({counts.openQuotes} open)
                                    </span>
                                </h3>
                                <p className="text-hackclub-slate text-sm">
                                    Price quotes with quantity breaks — compare vendors side-by-side at any quantity.
                                </p>
                            </div>
                        </Link>

                        <Link href="/admin/sourcing/pos">
                            <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-orange transition-all cursor-pointer group h-full">
                                <div className="w-12 h-12 bg-hackclub-orange/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-orange/20 transition-colors">
                                    <Icon glyph="package" size={24} style={{ color: 'var(--hackclub-orange, #F77F00)' }} />
                                </div>
                                <h3 className="text-xl font-black text-hackclub-dark mb-2">
                                    Purchase Orders{' '}
                                    <span className="text-hackclub-slate">
                                        · {counts.pos} ({counts.openPos} open)
                                    </span>
                                </h3>
                                <p className="text-hackclub-slate text-sm">
                                    Order from an accepted quote — receiving posts straight to inventory + cost basis.
                                </p>
                            </div>
                        </Link>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
