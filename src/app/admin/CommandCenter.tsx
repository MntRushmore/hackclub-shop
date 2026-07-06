'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

/**
 * Live ops action feed for the admin home — reads /api/admin/overview and surfaces
 * everything that needs a human, each row deep-linking to the right page with the
 * right filter. The payoff of "everything connected": it only works because the
 * sourcing / inventory / finance / orders layers feed it.
 */

interface Overview {
    canFinance: boolean;
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
            }>;
        };
        orders: { unfulfilled: number; oldestDays: number };
        finance: { uncostedVariants: number };
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
        <div className="text-right">
            <div className={`text-2xl font-black ${tone}`}>{value}</div>
            <div className="text-xs font-medium text-hackclub-slate">{label}</div>
        </div>
    );
}

function FeedCard({
    href,
    title,
    active,
    stat,
    children,
}: {
    href: string;
    title: string;
    active: boolean;
    stat: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <Link href={href} className={active ? '' : 'pointer-events-none'}>
            <div
                className={`h-full rounded-xl border bg-white p-5 shadow-sm transition-shadow ${
                    active ? 'border-gray-300 hover:shadow-md' : 'border-gray-200 opacity-60'
                }`}
            >
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-black text-hackclub-dark">{title}</h3>
                    {stat}
                </div>
                {children}
            </div>
        </Link>
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
                // best-effort; nothing else on the page depends on it
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200/60" />
                ))}
            </div>
        );
    }

    if (!data) return null;

    const { cards } = data;
    const nothing =
        cards.lowStock.count === 0 &&
        cards.orders.unfulfilled === 0 &&
        (!data.canFinance || cards.finance.uncostedVariants === 0);

    return (
        <div>
            {nothing && (
                <div className="mb-4 rounded-xl border border-hackclub-green/30 bg-hackclub-green/5 p-5 text-center">
                    <p className="font-black text-hackclub-green">All clear 🎉</p>
                    <p className="text-sm text-hackclub-slate">No low stock, unfulfilled orders, or uncosted stock.</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FeedCard
                    href="https://dashboard.stripe.com/products"
                    title="Reorder"
                    active={cards.lowStock.count > 0}
                    stat={<Stat value={cards.lowStock.count} label="below reorder point" tone="text-hackclub-red" />}
                >
                    <div className="space-y-1">
                        {cards.lowStock.items.map((it) => (
                            <div key={it.variantId} className="flex items-center justify-between gap-2 text-sm">
                                <span className="truncate text-hackclub-dark">{it.productName} · {it.variantName}</span>
                                <span className="whitespace-nowrap text-hackclub-slate">
                                    {it.available} ≤ {it.reorderPoint}
                                </span>
                            </div>
                        ))}
                        {cards.lowStock.count === 0 && <p className="text-sm text-hackclub-slate">Nothing low.</p>}
                    </div>
                </FeedCard>

                <FeedCard
                    href="/admin/orders"
                    title="Orders"
                    active={cards.orders.unfulfilled > 0}
                    stat={<Stat value={cards.orders.unfulfilled} label="unfulfilled" tone="text-hackclub-orange" />}
                >
                    <p className="text-sm text-hackclub-slate">
                        {cards.orders.unfulfilled > 0
                            ? `Oldest waiting ${cards.orders.oldestDays} day${cards.orders.oldestDays === 1 ? '' : 's'}.`
                            : 'Everything fulfilled.'}
                    </p>
                </FeedCard>

                {data.canFinance && (
                    <FeedCard
                        href="/admin/finance"
                        title="Uncosted stock"
                        active={cards.finance.uncostedVariants > 0}
                        stat={<Stat value={cards.finance.uncostedVariants} label="variants, no cost" tone="text-hackclub-purple" />}
                    >
                        <p className="text-sm text-hackclub-slate">
                            {cards.finance.uncostedVariants > 0 ? 'Set unit costs so valuation + margins are right.' : 'Everything costed.'}
                        </p>
                    </FeedCard>
                )}

                <div className="h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="font-black text-hackclub-dark">Recent activity</h3>
                        <Link href="/admin/audit" className="text-sm font-bold text-hackclub-blue hover:underline">Audit log →</Link>
                    </div>
                    <div className="space-y-1">
                        {cards.recentActivity.length === 0 && <p className="text-sm text-hackclub-slate">No recent activity.</p>}
                        {cards.recentActivity.map((a, i) => (
                            <div key={i} className="flex justify-between gap-2 text-sm">
                                <span className="truncate text-hackclub-dark">{a.summary}</span>
                                <span className="whitespace-nowrap text-hackclub-slate">{timeAgo(a.timestamp)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
