'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Icon from 'supercons';

export default function AdminDashboard() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin' });
        }
    }, [status]);

    useEffect(() => {
        const checkAdmin = async () => {
            if (!session?.user?.id) {
                console.log('No session or user ID');
                setLoading(false);
                return;
            }

            console.log('Checking admin status for user:', session.user.id);

            try {
                const res = await fetch('/api/admin/stats');
                console.log('Admin check response:', res.status);
                if (res.ok) {
                    console.log('User is admin');
                    setIsAdmin(true);
                } else {
                    console.log('User is not admin');
                    setIsAdmin(false);
                }
            } catch (error) {
                console.error('Admin check error:', error);
                setIsAdmin(false);
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            checkAdmin();
        }
    }, [session]);

    if (status === 'loading' || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (!session) {
        return null;
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white"
                style={{
                    backgroundImage: `
                      linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                      linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                    `,
                    backgroundSize: '30px 30px',
                }}
            >
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <div className="w-16 h-16 bg-hackclub-red/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon glyph="private" size={32} style={{ color: 'var(--hackclub-red, #EC3750)' }} />
                    </div>
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Access Denied</h2>
                    <p className="text-hackclub-slate mb-6">
                        You don't have permission to access the admin dashboard.
                    </p>
                    <Link
                        href="/"
                        className="inline-block w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Back to Shop
                    </Link>
                </div>
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
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                        Admin Dashboard
                    </h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-12">
                        Manage your store
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Projects */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                        >
                            <Link href="/admin/projects">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-cyan transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-cyan/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-cyan/20 transition-colors">
                                        <Icon glyph="code" size={24} style={{ color: 'var(--hackclub-cyan, #5bc0de)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Projects</h3>
                                    <p className="text-hackclub-slate text-sm">Review and approve project submissions</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Products */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <Link href="/admin/products">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-red transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-red/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-red/20 transition-colors">
                                        <Icon glyph="bag" size={24} style={{ color: 'var(--hackclub-red, #EC3750)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Products</h3>
                                    <p className="text-hackclub-slate text-sm">Create, edit, and manage your products</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Coupons */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                        >
                            <Link href="/admin/coupons">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-green transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-green/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-green/20 transition-colors">
                                        <Icon glyph="airdrop" size={24} style={{ color: 'var(--hackclub-green, #35B930)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Coupons</h3>
                                    <p className="text-hackclub-slate text-sm">Create and manage discount codes</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Orders */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                        >
                            <Link href="/admin/orders">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-orange transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-orange/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-orange/20 transition-colors">
                                        <Icon glyph="docs" size={24} style={{ color: 'var(--hackclub-orange, #F77F00)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Orders</h3>
                                    <p className="text-hackclub-slate text-sm">View and manage customer orders</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Users */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                        >
                            <Link href="/admin/users">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-blue transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-blue/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-blue/20 transition-colors">
                                        <Icon glyph="people-3" size={24} style={{ color: 'var(--hackclub-blue, #3291FF)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Users</h3>
                                    <p className="text-hackclub-slate text-sm">Manage user balances and credits</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Stats */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                        >
                            <Link href="/admin/stats">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-purple transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-purple/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-purple/20 transition-colors">
                                        <Icon glyph="pie-chart" size={24} style={{ color: 'var(--hackclub-purple, #8B5CF6)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Statistics</h3>
                                    <p className="text-hackclub-slate text-sm">View sales and order statistics</p>
                                </div>
                            </Link>
                        </motion.div>

                        {/* Admins */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6 }}
                        >
                            <Link href="/admin/admins">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-yellow transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-yellow/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-yellow/20 transition-colors">
                                        <Icon glyph="admin-badge" size={24} style={{ color: 'var(--hackclub-yellow, #FFC72C)' }} />
                                    </div>
                                    <h3 className="text-xl font-black text-hackclub-dark mb-2">Admins</h3>
                                    <p className="text-hackclub-slate text-sm">Manage admin roles and permissions</p>
                                </div>
                            </Link>
                        </motion.div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
