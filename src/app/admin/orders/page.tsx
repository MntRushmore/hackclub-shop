'use client';

import { useState, useEffect, useMemo } from 'react';
import { Order } from '../../../types/Order';
import { PageHeader, EmptyState, ErrorBanner, LoadingScreen } from '../ui';
import ShippingPanel from './ShippingPanel';

const PAGE_SIZE = 25;
type StatusFilter = 'all' | Order['status'];
type PathwayFilter = 'all' | 'student' | 'guest';

export default function OrdersAdmin() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [actingOrderId, setActingOrderId] = useState<string | null>(null);
    const [showTest, setShowTest] = useState(false);
    // Search / filter / pagination.
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [pathwayFilter, setPathwayFilter] = useState<PathwayFilter>('all');
    const [page, setPage] = useState(1);

    useEffect(() => {
        const fetchOrders = async () => {
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

        fetchOrders();
    }, []);

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

    // 'received' reads better to staff as "Order received" than the bare word.
    const statusLabel = (status: Order['status']) => (status === 'received' ? 'Order received' : status);

    const handleAction = async (
        e: React.MouseEvent,
        order: Order,
        action: 'refund' | 'mark-delivered' | 'mark-test' | 'unmark-test',
    ) => {
        e.stopPropagation();

        let message: string | undefined;
        if (action === 'refund') {
            // Explicit confirmation gate — a refund is irreversible money movement
            // (issues a real Stripe refund / credits points back). Guards against
            // an accidental click while testing whether the buttons work.
            const isCard = order.pathway === 'guest';
            const confirmMsg = isCard
                ? `Refund $${order.totalAmount.toFixed(2)} to ${order.guestEmail || 'this customer'}? This issues a real Stripe refund and cannot be undone.`
                : `Refund ${order.pointsSpent} points for order #${order.id.slice(-8)}? This credits the points back and cannot be undone.`;
            if (!window.confirm(confirmMsg)) return;

            const reason = window.prompt('Reason (optional):');
            // Cancelling the prompt aborts the action; an empty string is allowed.
            if (reason === null) return;
            message = reason || undefined;
        } else if (action === 'mark-delivered') {
            if (!window.confirm(`Mark order #${order.id.slice(-8)} as delivered?`)) return;
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

    // Filter pipeline: test toggle → status → pathway → free-text search.
    // Computed before any early return so hook order stays stable.
    const filteredOrders = useMemo(() => {
        const orderSearchText = (o: Order) =>
            [o.id, o.guestEmail, o.userId, ...o.items.map((i) => i.name), o.shipment?.trackingNumber]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
        const q = query.trim().toLowerCase();
        return orders.filter((o) => {
            // Hide unpaid guest placeholders: a guest order sits 'unpaid' only while
            // its Stripe checkout is in flight (or abandoned, pending deletion). It
            // isn't a real order until the webhook marks it paid, so keep it out of
            // the admin queue. Points orders are paid at creation → never 'unpaid'.
            if (o.pathway === 'guest' && o.paymentStatus === 'unpaid') return false;
            if (!showTest && o.isTest) return false;
            if (statusFilter !== 'all' && o.status !== statusFilter) return false;
            if (pathwayFilter !== 'all' && o.pathway !== pathwayFilter) return false;
            if (q && !orderSearchText(o).includes(q)) return false;
            return true;
        });
    }, [orders, showTest, statusFilter, pathwayFilter, query]);

    if (loading) {
        return (
            <>
                <PageHeader title="Orders" subtitle="View and manage all orders" />
                <LoadingScreen />
            </>
        );
    }

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);
    const visibleOrders = filteredOrders.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

    const exportCsv = () => {
        // Total (USD) is what the customer paid (tax-inclusive once Stripe settles);
        // Tax (USD) breaks out the collected sales tax so bookkeeping can back out
        // the pass-through liability. Points/HCB/pre-tax orders have no tax → 0.00.
        const headers = ['Order ID', 'Pathway', 'Status', 'Payment', 'Buyer', 'Items', 'Total (USD)', 'Tax (USD)', 'Points', 'Tracking', 'Created'];
        const rows = filteredOrders.map((o) => [
            o.id,
            o.pathway,
            o.status,
            o.paymentStatus || '',
            o.pathway === 'guest' ? o.guestEmail || '' : o.userId,
            o.items.map((i) => `${i.quantity}x ${i.name}`).join('; '),
            o.totalAmount.toFixed(2),
            (o.taxAmount || 0).toFixed(2),
            o.pointsSpent || 0,
            o.shipment?.trackingNumber || '',
            new Date(o.createdAt).toISOString(),
        ]);
        const esc = (v: unknown) => {
            let s = String(v);
            // Neutralize spreadsheet formula injection: a leading =,+,-,@ is treated
            // as a formula by Excel/Sheets. Prefix with an apostrophe to force text.
            if (/^[=+\-@]/.test(s)) s = `'${s}`;
            return `"${s.replace(/"/g, '""')}"`;
        };
        const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <>
            <PageHeader
                title="Orders"
                subtitle="View and manage all orders"
                actions={
                    <>
                        <select
                            value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
                            aria-label="Filter by status"
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-hackclub-dark focus:border-hackclub-red focus:outline-none"
                        >
                            <option value="all">All statuses</option>
                            <option value="received">Order received</option>
                            <option value="fulfilled">Fulfilled</option>
                            <option value="delivered">Delivered</option>
                            <option value="refunded">Refunded</option>
                        </select>
                        <select
                            value={pathwayFilter}
                            onChange={(e) => { setPathwayFilter(e.target.value as PathwayFilter); setPage(1); }}
                            aria-label="Filter by pathway"
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-hackclub-dark focus:border-hackclub-red focus:outline-none"
                        >
                            <option value="all">All pathways</option>
                            <option value="student">Points</option>
                            <option value="guest">Card</option>
                        </select>
                        <button
                            type="button"
                            onClick={exportCsv}
                            disabled={filteredOrders.length === 0}
                            className="rounded-lg bg-hackclub-blue px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
                        >
                            Export CSV
                        </button>
                    </>
                }
            />

            {/* Search + test toggle */}
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                    <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-hackclub-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                        placeholder="Search by order #, email, user, item, tracking…"
                        aria-label="Search orders"
                        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-11 pr-4 text-sm font-medium text-hackclub-dark transition-colors focus:border-hackclub-red focus:outline-none"
                    />
                </div>
                <div className="flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={() => { setShowTest((prev) => !prev); setPage(1); }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${showTest ? 'border-hackclub-dark bg-hackclub-dark text-white' : 'border-gray-300 bg-white text-hackclub-slate hover:border-gray-400'}`}
                        aria-pressed={showTest}
                    >
                        <span className={`w-2 h-2 rounded-full ${showTest ? 'bg-hackclub-green' : 'bg-hackclub-muted'}`} />
                        Show test orders
                    </button>
                    <p className="text-sm text-hackclub-muted font-bold">
                        {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}
                    </p>
                </div>
            </div>

            {error && <ErrorBanner message={error} />}

            <div className="space-y-4">
                {visibleOrders.length === 0 ? (
                    <EmptyState message="No orders yet" />
                ) : (
                    visibleOrders.map((order) => (
                        <div
                            key={order.id}
                            onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                            className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-sm text-hackclub-muted font-bold">Order #{order.id.slice(-8)}</p>
                                    <p className="text-xs text-hackclub-slate">{order.pathway === 'guest' ? `Guest: ${order.guestEmail || '—'}` : `User: ${order.userId}`}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {order.isTest && (
                                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                                            TEST
                                        </span>
                                    )}
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
                                        {statusLabel(order.status)}
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

                            <div className="pt-4 border-t border-gray-200 flex justify-between items-center">
                                <span className="text-hackclub-slate font-bold">Total</span>
                                <span className="text-lg font-black text-hackclub-dark">
                                    {order.pathway === 'guest' ? `$${order.totalAmount.toFixed(2)}` : `${order.pointsSpent} pts`}
                                </span>
                            </div>

                            {(() => {
                                const isActing = actingOrderId === order.id;
                                const btnBase = 'px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
                                const refundLabel = order.pathway === 'guest' ? 'Refund (card)' : 'Refund (points)';
                                const actions: { action: 'refund' | 'mark-delivered'; label: string; className: string }[] = [];

                                // Lifecycle: received → (ship via panel below) fulfilled →
                                // (carrier scan / manual) delivered. No approve/deny gate —
                                // paid orders are real on arrival. Refund is always available
                                // on a live order until it's already refunded.
                                if (order.status === 'fulfilled') {
                                    actions.push({ action: 'mark-delivered', label: 'Mark delivered', className: 'bg-hackclub-green hover:bg-green-600' });
                                }
                                if (order.status !== 'refunded') {
                                    actions.push({ action: 'refund', label: refundLabel, className: 'bg-hackclub-red hover:bg-red-600' });
                                }

                                const testAction: 'mark-test' | 'unmark-test' = order.isTest ? 'unmark-test' : 'mark-test';
                                const testLabel = order.isTest ? 'Untest' : 'Mark test';
                                const applyUpdate = (updated: Order) => {
                                    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
                                    setSelectedOrder((prev) => (prev && prev.id === updated.id ? updated : prev));
                                };

                                return (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {order.status === 'received' && (
                                            <ShippingPanel order={order} onShipped={applyUpdate} onError={setError} />
                                        )}
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
                                        <button
                                            type="button"
                                            onClick={(e) => handleAction(e, order, testAction)}
                                            disabled={isActing}
                                            className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isActing ? 'Working…' : testLabel}
                                        </button>
                                    </div>
                                );
                            })()}

                            {/* Shipping LEVEL the customer paid for, shown as soon as the
                                order exists (before a label is bought) so staff know exactly
                                what postage to purchase. Once a label is bought + tracking
                                recorded, the block below replaces this with tracking info. */}
                            {order.shipment && !order.shipment.trackingNumber && (order.shipment.carrier || order.shipment.service) && (
                                <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                    <span className="font-bold text-hackclub-dark">📦 Customer paid for:</span>
                                    <span className="font-bold text-hackclub-blue">
                                        {`${order.shipment.carrier || ''} ${order.shipment.service || ''}`.trim()}
                                    </span>
                                    {typeof order.shipment.cost === 'number' && (
                                        <span className="text-hackclub-slate">(${order.shipment.cost.toFixed(2)})</span>
                                    )}
                                    <span className="text-xs text-hackclub-muted">— buy this shipping level</span>
                                </div>
                            )}

                            {order.shipment?.trackingNumber && (
                                <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                    <span className="font-bold text-hackclub-dark">
                                        📦 {order.shipment.carrier || 'Shipped'}{order.shipment.service ? ` ${order.shipment.service}` : ''}
                                    </span>
                                    {order.shipment.trackingUrl ? (
                                        <a
                                            href={order.shipment.trackingUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="font-mono text-hackclub-blue hover:underline"
                                        >
                                            {order.shipment.trackingNumber}
                                        </a>
                                    ) : (
                                        <span className="font-mono text-hackclub-slate">{order.shipment.trackingNumber}</span>
                                    )}
                                    {order.shipment.labelUrl && (
                                        <a
                                            href={order.shipment.labelUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-hackclub-slate hover:text-hackclub-dark font-bold underline"
                                        >
                                            Label PDF
                                        </a>
                                    )}
                                </div>
                            )}

                            {selectedOrder?.id === order.id && order.statusHistory && order.statusHistory.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
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
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-8">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={clampedPage <= 1}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-hackclub-slate transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        ← Prev
                    </button>
                    <span className="text-sm font-bold text-hackclub-muted">
                        Page {clampedPage} of {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={clampedPage >= totalPages}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-hackclub-slate transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Next →
                    </button>
                </div>
            )}
        </>
    );
}
