'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Order } from '../../../types/Order';

export default function OrdersAdmin() {
    const { data: session, status } = useSession();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [actingOrderId, setActingOrderId] = useState<string | null>(null);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/orders' });
        }
    }, [status]);

    useEffect(() => {
        const fetchOrders = async () => {
            if (!session) return;

            try {
                const res = await fetch('/api/admin/stats?period=all');
                if (!res.ok) {
                    setError('Failed to fetch orders');
                    return;
                }
                const data = await res.json();
                setOrders(data.orders || []);
            } catch {
                setError('Failed to fetch orders');
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            fetchOrders();
        }
    }, [session]);

    const getStatusColor = (status: Order['status']) => {
        switch (status) {
            case 'pending':
                return 'bg-yellow-100 text-yellow-800';
            case 'approved':
                return 'bg-blue-100 text-blue-800';
            case 'fulfilled':
                return 'bg-green-100 text-green-800';
            case 'denied':
                return 'bg-red-100 text-red-800';
            case 'refunded':
                return 'bg-orange-100 text-orange-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    const handleAction = async (
        e: React.MouseEvent,
        order: Order,
        action: 'approve' | 'deny' | 'fulfill' | 'refund',
    ) => {
        e.stopPropagation();

        let message: string | undefined;
        if (action === 'deny' || action === 'refund') {
            const reason = window.prompt('Reason (optional):');
            // Cancelling the prompt aborts the action; an empty string is allowed.
            if (reason === null) return;
            message = reason || undefined;
        }

        setError(null);
        setActingOrderId(order.id);
        try {
            const res = await fetch(`/api/admin/orders/${order.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, message }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Action failed');
                return;
            }
            const updated: Order = data.order;
            setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
            setSelectedOrder((prev) => (prev && prev.id === updated.id ? updated : prev));
        } catch {
            setError('Action failed');
        } finally {
            setActingOrderId(null);
        }
    };

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
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                        Orders
                    </h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-12">
                        View and manage all orders
                    </p>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl"
                        >
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    <div className="space-y-4">
                        <AnimatePresence initial={false} mode="popLayout">
                            {orders.length === 0 ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-center py-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke"
                                >
                                    <p className="text-hackclub-muted font-bold">No orders yet</p>
                                </motion.div>
                            ) : (
                                orders.map((order, index) => (
                                    <motion.div
                                        key={order.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                                        className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 cursor-pointer hover:shadow-xl transition-shadow"
                                    >
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <p className="text-sm text-hackclub-muted font-bold">Order #{order.id.slice(-8)}</p>
                                                <p className="text-xs text-hackclub-slate">{order.pathway === 'guest' ? `Guest: ${order.guestEmail || '—'}` : `User: ${order.userId}`}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {order.pathway && (
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${order.pathway === 'guest' ? 'bg-purple-100 text-purple-800' : 'bg-cyan-100 text-cyan-800'}`}>
                                                        {order.pathway === 'guest' ? 'Card' : 'Points'}
                                                    </span>
                                                )}
                                                {order.paymentStatus && order.pathway === 'guest' && (
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'refunded' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                        {order.paymentStatus}
                                                    </span>
                                                )}
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            {order.items.map((item) => (
                                                <div key={item.id} className="flex justify-between text-sm">
                                                    <span className="text-hackclub-dark font-bold">{item.name} x{item.quantity}</span>
                                                    <span className="text-hackclub-slate">{order.pathway === 'guest' ? `$${(parseFloat(item.price) * item.quantity).toFixed(2)}` : ''}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="pt-4 border-t-2 border-hackclub-smoke flex justify-between items-center">
                                            <span className="text-hackclub-slate font-bold">Total</span>
                                            <span className="text-lg font-black text-hackclub-dark">
                                                {order.pathway === 'guest' ? `$${order.totalAmount.toFixed(2)}` : `${order.pointsSpent} pts`}
                                            </span>
                                        </div>

                                        {(() => {
                                            const isActing = actingOrderId === order.id;
                                            const btnBase = 'px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
                                            const refundLabel = order.pathway === 'guest' ? 'Refund (card)' : 'Refund (points)';
                                            const actions: { action: 'approve' | 'deny' | 'fulfill' | 'refund'; label: string; className: string }[] = [];

                                            if (order.status === 'pending') {
                                                actions.push({ action: 'approve', label: 'Approve', className: 'bg-hackclub-green hover:bg-green-600' });
                                                actions.push({ action: 'deny', label: 'Deny', className: 'bg-hackclub-red hover:bg-red-600' });
                                            } else if (order.status === 'approved') {
                                                actions.push({ action: 'fulfill', label: 'Fulfill', className: 'bg-hackclub-blue hover:bg-blue-600' });
                                                actions.push({ action: 'refund', label: refundLabel, className: 'bg-hackclub-red hover:bg-red-600' });
                                            } else if (order.status === 'fulfilled') {
                                                actions.push({ action: 'refund', label: refundLabel, className: 'bg-hackclub-red hover:bg-red-600' });
                                            }

                                            if (actions.length === 0) return null;

                                            return (
                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    {actions.map(({ action, label, className }) => (
                                                        <button
                                                            key={action}
                                                            type="button"
                                                            onClick={(e) => handleAction(e, order, action)}
                                                            disabled={isActing}
                                                            className={`${btnBase} ${className}`}
                                                        >
                                                            {isActing ? 'Working…' : label}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        })()}

                                        {selectedOrder?.id === order.id && order.statusHistory && order.statusHistory.length > 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-4 pt-4 border-t-2 border-hackclub-smoke space-y-2"
                                            >
                                                <p className="text-xs font-bold text-hackclub-muted uppercase">Status History</p>
                                                {order.statusHistory.map((update, idx) => (
                                                    <div key={idx} className="text-xs">
                                                        <p className="font-bold text-hackclub-dark capitalize">{update.status}</p>
                                                        <p className="text-hackclub-muted">{new Date(update.timestamp).toLocaleString()}</p>
                                                        {update.message && (
                                                            <p className="text-hackclub-slate italic mt-1">{update.message}</p>
                                                        )}
                                                    </div>
                                                ))}
                                            </motion.div>
                                        )}
                                    </motion.div>
                                ))
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
