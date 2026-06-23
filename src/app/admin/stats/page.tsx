'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

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
    const { data: session, status } = useSession();
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState('all');

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/stats' });
        }
    }, [status]);

    useEffect(() => {
        const fetchStats = async () => {
            if (!session) return;

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

        if (session) {
            fetchStats();
        }
    }, [session, period]);

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <div className="flex items-center justify-between mb-12">
                        <div>
                            <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                                ← Back to Dashboard
                            </Link>
                            <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                                Statistics
                            </h1>
                            <p className="text-lg text-hackclub-slate font-medium">
                                Sales and order analytics
                            </p>
                        </div>
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                            className="px-4 py-2 border-2 border-hackclub-smoke rounded-lg font-bold text-hackclub-dark"
                        >
                            <option value="all">All Time</option>
                            <option value="week">Last Week</option>
                            <option value="month">Last Month</option>
                            <option value="year">Last Year</option>
                        </select>
                    </div>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl"
                        >
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    {stats && (
                        <div className="space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 }}
                                    className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                                >
                                    <p className="text-hackclub-muted font-bold text-sm">Total Orders</p>
                                    <p className="text-4xl font-black text-hackclub-dark mt-2">{stats.totalOrders}</p>
                                </motion.div>

                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                                >
                                    <p className="text-hackclub-muted font-bold text-sm">Total Revenue</p>
                                    <p className="text-4xl font-black text-hackclub-dark mt-2">${stats.totalRevenue}</p>
                                </motion.div>

                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 }}
                                    className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                                >
                                    <p className="text-hackclub-muted font-bold text-sm">Average Order</p>
                                    <p className="text-4xl font-black text-hackclub-dark mt-2">
                                        ${stats.totalOrders > 0 ? (parseFloat(stats.totalRevenue) / stats.totalOrders).toFixed(2) : '0.00'}
                                    </p>
                                </motion.div>
                            </div>

                            {/* Operational cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                                    <p className="text-hackclub-muted font-bold text-sm">Cash Revenue</p>
                                    <p className="text-3xl font-black text-hackclub-green mt-2">${stats.cashRevenue}</p>
                                    <p className="text-xs text-hackclub-slate mt-1">{stats.guestOrderCount} card order{stats.guestOrderCount === 1 ? '' : 's'}</p>
                                </div>
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                                    <p className="text-hackclub-muted font-bold text-sm">Points Spent</p>
                                    <p className="text-3xl font-black text-hackclub-blue mt-2">{stats.pointsSpent.toLocaleString()}</p>
                                    <p className="text-xs text-hackclub-slate mt-1">{stats.studentOrderCount} points order{stats.studentOrderCount === 1 ? '' : 's'}</p>
                                </div>
                                <Link href="/admin/inventory">
                                    <div className={`bg-white rounded-2xl shadow-lg border-2 p-6 transition-colors ${stats.lowStockCount > 0 ? 'border-hackclub-orange/40 hover:border-hackclub-orange' : 'border-hackclub-smoke hover:border-hackclub-slate'}`}>
                                        <p className="text-hackclub-muted font-bold text-sm">Low Stock</p>
                                        <p className={`text-3xl font-black mt-2 ${stats.lowStockCount > 0 ? 'text-hackclub-orange' : 'text-hackclub-dark'}`}>{stats.lowStockCount}</p>
                                        <p className="text-xs text-hackclub-slate mt-1">variants ≤ 5 left</p>
                                    </div>
                                </Link>
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                                    <p className="text-hackclub-muted font-bold text-sm">Abandoned</p>
                                    <p className="text-3xl font-black text-hackclub-dark mt-2">{stats.abandonedSessions}</p>
                                    <p className="text-xs text-hackclub-slate mt-1">expired card sessions</p>
                                </div>
                            </div>

                            {/* Revenue over time */}
                            {stats.timeSeries.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.35 }}
                                    className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                                >
                                    <h2 className="text-2xl font-black text-hackclub-dark mb-6">Revenue over time</h2>
                                    <RevenueChart data={stats.timeSeries} />
                                </motion.div>
                            )}

                            {/* Orders by Status */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                            >
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">Orders by Status</h2>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    {['pending', 'approved', 'fulfilled', 'denied', 'refunded'].map((status) => (
                                        <div key={status} className="text-center p-4 bg-hackclub-smoke/30 rounded-lg">
                                            <p className="text-hackclub-slate text-sm font-bold capitalize mb-2">{status}</p>
                                            <p className="text-3xl font-black text-hackclub-dark">{stats.ordersByStatus[status] || 0}</p>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>

                            {/* Top Products */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 }}
                                className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6"
                            >
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">Top Products</h2>
                                <div className="space-y-3">
                                    {stats.topProducts.length === 0 ? (
                                        <p className="text-hackclub-muted font-bold">No products sold yet</p>
                                    ) : (
                                        stats.topProducts.map((product, index) => (
                                            <div
                                                key={product.id}
                                                className="flex items-center justify-between p-4 bg-hackclub-smoke/30 rounded-lg"
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
                            </motion.div>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
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
