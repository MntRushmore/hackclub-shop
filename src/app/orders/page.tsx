'use client';

import { useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signIn } from 'next-auth/react';
import Image from 'next/image';
import { Order } from '../../types/Order';
import { OrderSkeleton } from '../components/Skeleton';
import { CartContext } from '../../context/CartContext';

const OrdersPage = () => {
    const { data: session, status } = useSession();
    const router = useRouter();
    const cart = useContext(CartContext);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reordering, setReordering] = useState<string | null>(null);

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
            case 'received':
                return 'bg-yellow-100 text-yellow-800';
            case 'fulfilled':
                return 'bg-blue-100 text-blue-800';
            case 'delivered':
                return 'bg-green-100 text-green-800';
            case 'refunded':
                return 'bg-orange-100 text-orange-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    // Reorder: re-fetch each product so prices/availability are current and
    // correct for whichever pathway the shopper is on (the stored order item only
    // carries the historical USD price — points orders store "0"). Falls back to
    // the stored price if the product can't be re-fetched. addToCart increments by
    // one, so add once per unit.
    const handleReorder = async (order: Order) => {
        if (!cart) return;
        setReordering(order.id);
        try {
            // De-dupe product lookups across items in the order.
            const productCache: Record<string, any> = {};
            for (const item of order.items) {
                const productId = String(item.id);
                if (!(productId in productCache)) {
                    try {
                        const res = await fetch(`/api/products/${productId}`);
                        const data = res.ok ? await res.json() : null;
                        productCache[productId] = data?.result || null;
                    } catch {
                        productCache[productId] = null;
                    }
                }
                const result = productCache[productId];
                const variant = result?.sync_variants?.find((v: any) => v.name === item.name) || result?.sync_variants?.[0];

                const cartItem = variant
                    ? {
                          id: productId,
                          name: variant.name,
                          price: String(variant.price_cash ?? 0),
                          price_cash: variant.price_cash || undefined,
                          price_points: variant.price_points || undefined,
                          thumbnail_url: variant.product?.image || item.thumbnail_url || '',
                          variant_id: variant.variant_id || variant.id,
                      }
                    : {
                          id: productId,
                          name: item.name,
                          price: item.price,
                          price_cash: parseFloat(item.price) || undefined,
                          thumbnail_url: item.thumbnail_url || '',
                      };

                for (let i = 0; i < item.quantity; i++) cart.addToCart(cartItem);
            }
            router.push('/shop?reordered=1');
        } finally {
            setReordering(null);
        }
    };

    if (status === 'loading' || (session && loading)) {
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
                <div className="max-w-2xl mx-auto px-4 py-12">
                    <div className="mb-10">
                        <div className="h-12 w-48 bg-hackclub-smoke rounded animate-pulse mb-2" />
                        <div className="h-6 w-64 bg-hackclub-smoke rounded animate-pulse" />
                    </div>
                    <div className="space-y-6">
                        <OrderSkeleton />
                        <OrderSkeleton />
                    </div>
                </div>
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
                                                <p className="text-sm text-hackclub-muted font-bold">Order #{order.id.slice(-8)}</p>
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

                                        <div className="px-6 py-4 border-t-2 border-hackclub-smoke space-y-2">
                                             <div className="flex justify-between items-center">
                                                 <p className="font-bold text-hackclub-slate">Subtotal (cash):</p>
                                                 <p className="font-bold text-hackclub-dark">${(order.subtotal || 0).toFixed(2)}</p>
                                             </div>
                                             {order.couponDiscount ? (
                                                 <div className="flex justify-between items-center text-hackclub-green">
                                                     <p className="font-bold text-hackclub-slate">Discount:</p>
                                                     <p className="font-bold">-${(order.couponDiscount || 0).toFixed(2)}</p>
                                                 </div>
                                             ) : null}
                                             {order.shippingCost ? (
                                                 <div className="flex justify-between items-center">
                                                     <p className="font-bold text-hackclub-slate">Shipping:</p>
                                                     <p className="font-bold text-hackclub-dark">${(order.shippingCost || 0).toFixed(2)}</p>
                                                 </div>
                                             ) : null}
                                             {order.taxAmount ? (
                                                 <div className="flex justify-between items-center">
                                                     <p className="font-bold text-hackclub-slate">Sales tax:</p>
                                                     <p className="font-bold text-hackclub-dark">${(order.taxAmount || 0).toFixed(2)}</p>
                                                 </div>
                                             ) : null}
                                             <div className="flex justify-between items-center pt-2 border-t border-hackclub-smoke">
                                                 <p className="font-bold text-hackclub-slate">Cash Due:</p>
                                                 <p className="text-lg font-black text-hackclub-dark">${(order.totalAmount || 0).toFixed(2)}</p>
                                             </div>
                                             {order.pointsSpent ? (
                                                 <div className="flex justify-between items-center text-hackclub-dark">
                                                     <p className="font-bold text-hackclub-slate">Points Spent:</p>
                                                     <p className="text-lg font-black">{order.pointsSpent} pts</p>
                                                 </div>
                                             ) : null}
                                         </div>

                                        {order.shipment?.trackingNumber && (
                                            <div className="px-6 py-4 border-t-2 border-hackclub-smoke">
                                                <div className="rounded-xl bg-hackclub-snow border-2 border-hackclub-smoke px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-xs font-bold text-hackclub-muted uppercase">
                                                            📦 Shipped{order.shipment.carrier ? ` · ${order.shipment.carrier}${order.shipment.service ? ` ${order.shipment.service}` : ''}` : ''}
                                                        </p>
                                                        <p className="font-mono text-sm text-hackclub-dark">{order.shipment.trackingNumber}</p>
                                                        {order.shipment.estDeliveryDate && (
                                                            <p className="text-xs text-hackclub-slate mt-0.5">Est. delivery: {order.shipment.estDeliveryDate}</p>
                                                        )}
                                                    </div>
                                                    {order.shipment.trackingUrl && (
                                                        <a
                                                            href={order.shipment.trackingUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="bg-hackclub-red hover:bg-hackclub-orange text-white font-bold text-sm py-2 px-4 rounded-full transition-colors whitespace-nowrap"
                                                        >
                                                            Track package →
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {cart && order.items.length > 0 && (
                                            <div className="px-6 py-4 border-t-2 border-hackclub-smoke">
                                                <button
                                                    type="button"
                                                    onClick={() => handleReorder(order)}
                                                    disabled={reordering === order.id}
                                                    className="inline-flex items-center gap-2 text-hackclub-blue hover:text-hackclub-dark font-bold text-sm transition-colors disabled:opacity-50"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                    </svg>
                                                    {reordering === order.id ? 'Adding to cart…' : 'Reorder these items'}
                                                </button>
                                            </div>
                                        )}

                                        {order.statusHistory && order.statusHistory.length > 0 && (
                                            <div className="px-6 py-4 border-t-2 border-hackclub-smoke space-y-2">
                                                <p className="text-xs font-bold text-hackclub-muted uppercase">Status History</p>
                                                <div className="space-y-1">
                                                    {order.statusHistory.map((update, index) => (
                                                        <div key={index} className="text-xs">
                                                            <p className="font-bold text-hackclub-dark capitalize">{update.status}</p>
                                                            <p className="text-hackclub-muted">{formatDate(update.timestamp)}</p>
                                                            {update.message && (
                                                                <p className="text-hackclub-slate italic mt-1">{update.message}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}

                    <p className="text-center text-sm text-hackclub-muted mt-10">
                        Questions about an order? Email{' '}
                        <a href="mailto:shop@hackclub.com" className="text-hackclub-blue font-bold hover:underline">shop@hackclub.com</a>
                    </p>
                </motion.div>
            </div>
        </div>
    );
};

export default OrdersPage;
