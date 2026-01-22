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
