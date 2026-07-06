'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageHeader, Card, ErrorBanner, EmptyState, LoadingScreen } from '../ui';

interface StatsData {
    period: string;
    totalOrders: number;
    totalRevenue: string;
    ordersByStatus: Record<string, number>;
    topProducts: Array<{ id: string; name: string; quantity: number; revenue: number }>;
    cashRevenue: string;
    pointsSpent: number;
    guestOrderCount: number;
    studentOrderCount: number;
    timeSeries: Array<{ date: string; revenue: number; orders: number }>;
    abandonedSessions: number;
    lowStockCount: number;
}

export default function StatsAdmin() {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState('all');

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            setError(null);

            try {
                const res = await fetch(`/api/admin/stats?period=${period}`);
                if (!res.ok) {
                    setError('Failed to fetch stats');
                    return;
                }
                const data = await res.json();
                setStats(data);
            } catch {
                setError('Failed to fetch stats');
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [period]);

    return (
        <>
            <PageHeader
                title="Statistics"
                subtitle="Sales and order analytics"
                actions={
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-hackclub-dark"
                    >
                        <option value="all">All Time</option>
                        <option value="week">Last Week</option>
                        <option value="month">Last Month</option>
                        <option value="year">Last Year</option>
                    </select>
                }
            />

            {error && <ErrorBanner message={error} />}

            {loading ? (
                <LoadingScreen />
            ) : (
                stats && (
                    <div className="space-y-6">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Total Orders</p>
                                <p className="text-3xl font-black text-hackclub-dark mt-2">{stats.totalOrders}</p>
                            </Card>

                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Total Revenue</p>
                                <p className="text-3xl font-black text-hackclub-dark mt-2">${stats.totalRevenue}</p>
                            </Card>

                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Average Order</p>
                                <p className="text-3xl font-black text-hackclub-dark mt-2">
                                    ${stats.totalOrders > 0 ? (parseFloat(stats.totalRevenue) / stats.totalOrders).toFixed(2) : '0.00'}
                                </p>
                            </Card>
                        </div>

                        {/* Operational cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Cash Revenue</p>
                                <p className="text-3xl font-black text-hackclub-green mt-2">${stats.cashRevenue}</p>
                                <p className="text-xs text-hackclub-slate mt-1">{stats.guestOrderCount} card order{stats.guestOrderCount === 1 ? '' : 's'}</p>
                            </Card>
                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Points Spent</p>
                                <p className="text-3xl font-black text-hackclub-blue mt-2">{stats.pointsSpent.toLocaleString()}</p>
                                <p className="text-xs text-hackclub-slate mt-1">{stats.studentOrderCount} points order{stats.studentOrderCount === 1 ? '' : 's'}</p>
                            </Card>
                            <Link href="https://dashboard.stripe.com/products">
                                <div className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${stats.lowStockCount > 0 ? 'border-hackclub-orange/40 hover:border-hackclub-orange' : 'border-gray-200 hover:border-hackclub-slate'}`}>
                                    <p className="text-hackclub-muted font-bold text-sm">Low Stock</p>
                                    <p className={`text-3xl font-black mt-2 ${stats.lowStockCount > 0 ? 'text-hackclub-orange' : 'text-hackclub-dark'}`}>{stats.lowStockCount}</p>
                                    <p className="text-xs text-hackclub-slate mt-1">variants ≤ 5 left</p>
                                </div>
                            </Link>
                            <Card>
                                <p className="text-hackclub-muted font-bold text-sm">Abandoned</p>
                                <p className="text-3xl font-black text-hackclub-dark mt-2">{stats.abandonedSessions}</p>
                                <p className="text-xs text-hackclub-slate mt-1">expired card sessions</p>
                            </Card>
                        </div>

                        {/* Revenue over time */}
                        {stats.timeSeries.length > 0 && (
                            <Card>
                                <h2 className="text-lg font-black text-hackclub-dark mb-4">Revenue over time</h2>
                                <RevenueChart data={stats.timeSeries} />
                            </Card>
                        )}

                        {/* Orders by Status */}
                        <Card>
                            <h2 className="text-lg font-black text-hackclub-dark mb-4">Orders by Status</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[
                                    { key: 'received', label: 'Received' },
                                    { key: 'fulfilled', label: 'Fulfilled' },
                                    { key: 'delivered', label: 'Delivered' },
                                    { key: 'refunded', label: 'Refunded' },
                                ].map(({ key, label }) => (
                                    <div key={key} className="text-center p-4 bg-gray-50 rounded-lg">
                                        <p className="text-hackclub-slate text-sm font-bold mb-2">{label}</p>
                                        <p className="text-3xl font-black text-hackclub-dark">{stats.ordersByStatus[key] || 0}</p>
                                    </div>
                                ))}
                            </div>
                        </Card>

                        {/* Top Products */}
                        <Card>
                            <h2 className="text-lg font-black text-hackclub-dark mb-4">Top Products</h2>
                            <div className="space-y-3">
                                {stats.topProducts.length === 0 ? (
                                    <EmptyState message="No products sold yet" />
                                ) : (
                                    stats.topProducts.map((product, index) => (
                                        <div
                                            key={product.id}
                                            className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 bg-hackclub-red text-white rounded-full flex items-center justify-center font-black text-sm">
                                                    {index + 1}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-hackclub-dark">{product.name}</p>
                                                    <p className="text-sm text-hackclub-muted">{product.quantity} sold</p>
                                                </div>
                                            </div>
                                            <p className="font-black text-hackclub-dark">${product.revenue.toFixed(2)}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </Card>
                    </div>
                )
            )}
        </>
    );
}

/**
 * Lightweight inline-SVG bar chart for daily revenue. No external chart library
 * (keeps the bundle small and is CSP-safe). Bars scale to the max day; hover
 * shows the exact value via the native title tooltip.
 */
function RevenueChart({ data }: { data: Array<{ date: string; revenue: number; orders: number }> }) {
    const max = Math.max(1, ...data.map((d) => d.revenue));
    // Cap the number of labelled ticks so dense ranges stay readable.
    const labelEvery = Math.ceil(data.length / 8);
    return (
        <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 min-w-full h-48" style={{ minWidth: `${data.length * 16}px` }}>
                {data.map((d, i) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end group" style={{ minWidth: '10px' }}>
                        <div
                            className="w-full bg-hackclub-red/80 group-hover:bg-hackclub-red rounded-t transition-colors"
                            style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }}
                            title={`${d.date}: $${d.revenue.toFixed(2)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`}
                        />
                        <span className="text-[9px] text-hackclub-muted mt-1 whitespace-nowrap" style={{ visibility: i % labelEvery === 0 ? 'visible' : 'hidden' }}>
                            {d.date.slice(5)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
