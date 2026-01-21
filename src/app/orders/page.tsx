'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signIn } from 'next-auth/react';
import Image from 'next/image';
import { Order } from '../../types/Order';

const OrdersPage = () => {
    const { data: session, status } = useSession();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchOrders = async () => {
            if (!session) return;
            
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/orders');
                const data = await res.json();
                if (res.ok) {
                    setOrders(data.orders || []);
                } else {
                    setError(data.error || 'Failed to load orders');
                }
            } catch (err) {
                console.error(err);
                setError('Failed to load orders');
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            fetchOrders();
        }
    }, [session]);

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const getStatusColor = (status: Order['status']) => {
        switch (status) {
            case 'pending':
                return 'bg-yellow-100 text-yellow-800';
            case 'completed':
                return 'bg-green-100 text-green-800';
            case 'cancelled':
                return 'bg-red-100 text-red-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    if (status === 'loading') {
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
                <div className="animate-pulse text-hackclub-slate font-bold">Loading...</div>
            </div>
        );
    }

    if (!session) {
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
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Sign In Required</h2>
                    <p className="text-hackclub-slate mb-6">
                        You need to sign in with your Hack Club account to view your order history.
                    </p>
                    <button
                        onClick={() => signIn('hackclub')}
                        className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Sign In with Hack Club
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen text-hackclub-dark bg-white"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                        Order History
                    </h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-10">
                        View your past orders and their status
                    </p>

                    {loading ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-12 text-center"
                        >
                            <div className="animate-spin w-8 h-8 border-4 border-hackclub-red border-t-transparent rounded-full mx-auto mb-4"></div>
                            <p className="text-hackclub-muted font-bold">Loading orders...</p>
                        </motion.div>
                    ) : error ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-red/20 p-8 text-center"
                        >
                            <div className="w-14 h-14 bg-hackclub-red/10 rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg className="w-7 h-7 text-hackclub-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    ) : orders.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.35 }}
                            className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-12 text-center"
                        >
                            <div className="w-14 h-14 bg-hackclub-smoke rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg className="w-7 h-7 text-hackclub-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                </svg>
                            </div>
                            <p className="text-hackclub-muted font-bold">No orders yet</p>
                            <p className="text-hackclub-slate text-sm mt-1">Your orders will appear here</p>
                        </motion.div>
                    ) : (
                        <div className="space-y-4">
                            <AnimatePresence initial={false}>
                                {orders.map((order, index) => (
                                    <motion.div
                                        key={order.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden"
                                    >
                                        <div className="px-6 py-4 border-b-2 border-hackclub-smoke flex items-center justify-between">
                                            <div>
                                                <p className="text-sm text-hackclub-muted font-bold">Order #{order.id}</p>
                                                <p className="text-xs text-hackclub-slate">{formatDate(order.createdAt)}</p>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(order.status)}`}>
                                                {order.status}
                                            </span>
                                        </div>

                                        <div className="px-6 py-4 space-y-3">
                                            {order.items.map((item) => (
                                                <div key={item.id} className="flex items-center gap-4">
                                                    {item.thumbnail_url && (
                                                        <Image
                                                            src={item.thumbnail_url}
                                                            alt={item.name}
                                                            width={48}
                                                            height={48}
                                                            className="w-12 h-12 rounded-lg object-cover"
                                                        />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-hackclub-dark truncate">{item.name}</p>
                                                        <p className="text-sm text-hackclub-muted">Qty: {item.quantity}</p>
                                                    </div>
                                                    <p className="font-bold text-hackclub-dark">${(parseFloat(item.price) * item.quantity).toFixed(2)}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="px-6 py-4 border-t-2 border-hackclub-smoke bg-hackclub-smoke/30 flex items-center justify-between">
                                            <p className="font-bold text-hackclub-slate">Total</p>
                                            <p className="text-xl font-black text-hackclub-dark">${order.totalAmount.toFixed(2)}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
};

export default OrdersPage;
