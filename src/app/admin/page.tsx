'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';

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
                        <svg className="w-8 h-8 text-hackclub-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
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
                        {/* Products */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <Link href="/admin/products">
                                <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 hover:shadow-xl hover:border-hackclub-red transition-all cursor-pointer group">
                                    <div className="w-12 h-12 bg-hackclub-red/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-hackclub-red/20 transition-colors">
                                        <svg className="w-6 h-6 text-hackclub-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                        </svg>
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
                                        <svg className="w-6 h-6 text-hackclub-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 012-2h6a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
                                        </svg>
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
                                        <svg className="w-6 h-6 text-hackclub-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
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
                                        <svg className="w-6 h-6 text-hackclub-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 8.048M12 9v.01M17 19H7a2 2 0 01-2-2V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2z" />
                                        </svg>
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
                                        <svg className="w-6 h-6 text-hackclub-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                        </svg>
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
                                        <svg className="w-6 h-6 text-hackclub-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
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
