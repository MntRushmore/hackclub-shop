'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

/**
 * Live ops action feed for the admin home — reads /api/admin/overview and surfaces
 * everything that needs a human, each row deep-linking to the right page with the
 * right filter. The payoff of "everything connected": it only works because the
 * sourcing / inventory / finance / orders layers feed it.
 */

interface Overview {
    canFinance: boolean;
    canSourcing: boolean;
    canProducts?: boolean;
    cards: {
        lowStock: {
            count: number;
            items: Array<{
                productId: string;
                variantId: string;
                productName: string;
                variantName: string;
                available: number;
                reorderPoint: number;
                cheapestVendorId?: string;
            }>;
        };
        orders: { unfulfilled: number; oldestDays: number };
        expiringQuotes: { count: number; items: Array<{ id: string; itemName: string; daysLeft: number }> };
        overduePOs: { count: number; openCount: number; items: Array<{ id: string; status: string }> };
        finance: { uncostedVariants: number };
        labels?: { unlabeledVariants: number };
        recentActivity: Array<{ action: string; summary: string; actorEmail?: string; timestamp: string }>;
    };
}

const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
    return (
        <div>
            <div className={`text-3xl font-black ${tone}`}>{value}</div>
            <div className="text-xs text-hackclub-slate font-medium">{label}</div>
        </div>
    );
}

export default function CommandCenter() {
    const [data, setData] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/overview');
                if (res.ok) setData(await res.json());
            } catch {
                // best-effort; the card grid below still works
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return (
            <div className="mb-12 grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-28 bg-hackclub-smoke/40 rounded-2xl animate-pulse" />
                ))}
            </div>
        );
    }

    if (!data) return null;

    const { cards } = data;
    const unlabeled = cards.labels?.unlabeledVariants ?? 0;
    const nothing =
        cards.lowStock.count === 0 &&
        cards.orders.unfulfilled === 0 &&
        cards.expiringQuotes.count === 0 &&
        cards.overduePOs.count === 0 &&
        (!data.canFinance || cards.finance.uncostedVariants === 0) &&
        (!data.canProducts || unlabeled === 0);

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mb-12">
            <h2 className="text-2xl font-black text-hackclub-dark mb-4">Needs attention</h2>

            {nothing && (
                <div className="mb-6 p-6 bg-hackclub-green/5 border-2 border-hackclub-green/30 rounded-2xl text-center">
                    <p className="text-hackclub-green font-black text-lg">All clear 🎉</p>
                    <p className="text-hackclub-slate text-sm">No low stock, unfulfilled orders, expiring quotes, or overdue POs.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Low stock / reorder */}
                <Link href="https://dashboard.stripe.com/products" className={cards.lowStock.count === 0 ? 'pointer-events-none' : ''}>
                    <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${cards.lowStock.count > 0 ? 'border-hackclub-red/40 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-black text-hackclub-dark">Reorder</h3>
                            <Stat value={cards.lowStock.count} label="below reorder point" tone="text-hackclub-red" />
                        </div>
                        <div className="space-y-1">
                            {cards.lowStock.items.map((it) => (
                                <div key={it.variantId} className="text-sm flex items-center justify-between gap-2">
                                    <span className="text-hackclub-dark truncate">{it.productName} · {it.variantName}</span>
                                    <span className="text-hackclub-slate whitespace-nowrap">
                                        {it.available} ≤ {it.reorderPoint}
                                        {it.cheapestVendorId && data.canSourcing && (
                                            <Link href={`/admin/sourcing/quotes?vendorId=${it.cheapestVendorId}`} className="ml-2 text-hackclub-blue font-bold hover:underline">
                                                start PO
                                            </Link>
                                        )}
                                    </span>
                                </div>
                            ))}
                            {cards.lowStock.count === 0 && <p className="text-hackclub-slate text-sm">Nothing low.</p>}
                        </div>
                    </div>
                </Link>

                {/* Orders */}
                <Link href="/admin/orders" className={cards.orders.unfulfilled === 0 ? 'pointer-events-none' : ''}>
                    <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${cards.orders.unfulfilled > 0 ? 'border-hackclub-orange/40 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-black text-hackclub-dark">Orders</h3>
                            <Stat value={cards.orders.unfulfilled} label="unfulfilled" tone="text-hackclub-orange" />
                        </div>
                        <p className="text-sm text-hackclub-slate">
                            {cards.orders.unfulfilled > 0
                                ? `Oldest waiting ${cards.orders.oldestDays} day${cards.orders.oldestDays === 1 ? '' : 's'}.`
                                : 'Everything fulfilled.'}
                        </p>
                    </div>
                </Link>

                {/* Expiring quotes */}
                {data.canSourcing && (
                    <Link href="/admin/sourcing/quotes" className={cards.expiringQuotes.count === 0 ? 'pointer-events-none' : ''}>
                        <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${cards.expiringQuotes.count > 0 ? 'border-hackclub-yellow/60 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-black text-hackclub-dark">Quotes expiring</h3>
                                <Stat value={cards.expiringQuotes.count} label="within 14 days" tone="text-hackclub-dark" />
                            </div>
                            <div className="space-y-1">
                                {cards.expiringQuotes.items.map((q) => (
                                    <div key={q.id} className="text-sm flex justify-between gap-2">
                                        <span className="text-hackclub-dark truncate">{q.itemName}</span>
                                        <span className="text-hackclub-slate whitespace-nowrap">{q.daysLeft <= 0 ? 'expired' : `${q.daysLeft}d`}</span>
                                    </div>
                                ))}
                                {cards.expiringQuotes.count === 0 && <p className="text-hackclub-slate text-sm">None expiring.</p>}
                            </div>
                        </div>
                    </Link>
                )}

                {/* Overdue POs */}
                {data.canSourcing && (
                    <Link href="/admin/sourcing/pos" className={cards.overduePOs.openCount === 0 ? 'pointer-events-none' : ''}>
                        <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${cards.overduePOs.count > 0 ? 'border-hackclub-red/40 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-black text-hackclub-dark">Purchase orders</h3>
                                <Stat value={cards.overduePOs.count} label={`overdue · ${cards.overduePOs.openCount} open`} tone={cards.overduePOs.count > 0 ? 'text-hackclub-red' : 'text-hackclub-dark'} />
                            </div>
                            <p className="text-sm text-hackclub-slate">
                                {cards.overduePOs.count > 0
                                    ? `${cards.overduePOs.count} past expected date.`
                                    : cards.overduePOs.openCount > 0
                                        ? 'All open POs on schedule.'
                                        : 'No open POs.'}
                            </p>
                        </div>
                    </Link>
                )}

                {/* Finance: uncosted */}
                {data.canFinance && (
                    <Link href="/admin/finance" className={cards.finance.uncostedVariants === 0 ? 'pointer-events-none' : ''}>
                        <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${cards.finance.uncostedVariants > 0 ? 'border-hackclub-purple/40 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-black text-hackclub-dark">Uncosted stock</h3>
                                <Stat value={cards.finance.uncostedVariants} label="variants, no cost" tone="text-hackclub-purple" />
                            </div>
                            <p className="text-sm text-hackclub-slate">
                                {cards.finance.uncostedVariants > 0 ? 'Set unit costs so valuation + margins are right.' : 'Everything costed.'}
                            </p>
                        </div>
                    </Link>
                )}

                {/* Labels: unlabeled variants */}
                {data.canProducts && (
                    <Link href="/admin/labels" className={unlabeled === 0 ? 'pointer-events-none' : ''}>
                        <div className={`h-full bg-white rounded-2xl border-2 p-5 transition-all ${unlabeled > 0 ? 'border-hackclub-purple/40 hover:shadow-lg' : 'border-hackclub-smoke opacity-70'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-black text-hackclub-dark">Unlabeled stock</h3>
                                <Stat value={unlabeled} label="variants, no barcode" tone="text-hackclub-purple" />
                            </div>
                            <p className="text-sm text-hackclub-slate">
                                {unlabeled > 0 ? 'Generate SKUs + print labels so they can be scanned to receive.' : 'Everything labeled.'}
                            </p>
                        </div>
                    </Link>
                )}

                {/* Recent activity */}
                <div className="h-full bg-white rounded-2xl border-2 border-hackclub-smoke p-5">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-black text-hackclub-dark">Recent activity</h3>
                        <Link href="/admin/audit" className="text-sm font-bold text-hackclub-blue hover:underline">Audit log →</Link>
                    </div>
                    <div className="space-y-1">
                        {cards.recentActivity.length === 0 && <p className="text-hackclub-slate text-sm">No recent activity.</p>}
                        {cards.recentActivity.map((a, i) => (
                            <div key={i} className="text-sm flex justify-between gap-2">
                                <span className="text-hackclub-dark truncate">{a.summary}</span>
                                <span className="text-hackclub-slate whitespace-nowrap">{timeAgo(a.timestamp)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
