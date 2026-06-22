import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { getGuestOrder, updateGuestOrder } from '../../../../../lib/guestOrders';
import { mirrorOrder } from '../../../../../lib/airtableMirror';
import { getStripe, isStripeConfigured } from '../../../../../lib/stripe';
import { sendEmail, buildStatusUpdate } from '../../../../../lib/email';
import { Order, OrderStatusUpdate } from '../../../../../types/Order';
import { PointsTransaction } from '../../../../../types/Points';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

type Action = 'approve' | 'deny' | 'fulfill' | 'refund';
const ACTION_STATUS: Record<Action, Order['status']> = {
    approve: 'approved',
    deny: 'denied',
    fulfill: 'fulfilled',
    refund: 'refunded',
};

/**
 * Admin order management — the web-dashboard replacement for the old Slack
 * action buttons. Handles both pathways:
 *   - student orders live in arrays under user:${userId}:orders
 *   - guest orders are standalone under order:${id}
 * Refund semantics differ by pathway: students get points credited back; guests
 * get a real Stripe refund via the API.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions);
    // Order management was historically gated on canManageBalance; keep that.
    const canManage = await requireAdminPermission(session, 'canManageBalance');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const orderId = params.id;
    const { action, message } = (await request.json()) as { action: Action; message?: string };

    if (!action || !(action in ACTION_STATUS)) {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    const newStatus = ACTION_STATUS[action];

    try {
        // ── Guest (Stripe) order ──────────────────────────────────────────────
        const guest = await getGuestOrder(orderId);
        if (guest) {
            if (action === 'refund') {
                if (guest.paymentStatus !== 'paid') {
                    return NextResponse.json({ error: 'Order is not paid; nothing to refund.' }, { status: 400 });
                }
                if (isStripeConfigured() && guest.stripePaymentIntentId) {
                    try {
                        await getStripe().refunds.create({ payment_intent: guest.stripePaymentIntentId });
                    } catch (err) {
                        console.error('[Admin order] Stripe refund failed:', err);
                        return NextResponse.json({ error: 'Stripe refund failed. Check the dashboard.' }, { status: 502 });
                    }
                }
            }

            const updated = await updateGuestOrder(orderId, {
                status: newStatus,
                ...(action === 'refund' ? { paymentStatus: 'refunded' as const } : {}),
                statusHistory: [...(guest.statusHistory || []), historyEntry(newStatus, message)],
            });
            if (updated) {
                void mirrorOrder(updated);
                if (updated.guestEmail) void sendEmail(buildStatusUpdate(updated, updated.guestEmail, message));
            }
            return NextResponse.json({ order: updated });
        }

        // ── Student (points) order ────────────────────────────────────────────
        const result = await updateStudentOrder(orderId, newStatus, message, action === 'refund');
        if (!result) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }
        if (result.email) void sendEmail(buildStatusUpdate(result.order, result.email, message));
        void mirrorOrder(result.order);
        return NextResponse.json({ order: result.order, pointsRefunded: result.pointsRefunded });
    } catch (error) {
        console.error('[Admin order] Error:', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}

function historyEntry(status: Order['status'], message?: string): OrderStatusUpdate {
    return { status, timestamp: new Date(), ...(message ? { message } : {}) };
}

/**
 * Find a student order across all user order lists, update its status, and (for
 * a refund) credit the points back. Returns the updated order + the user's email
 * for the status email, or null if not found.
 */
async function updateStudentOrder(
    orderId: string,
    newStatus: Order['status'],
    message: string | undefined,
    isRefund: boolean,
): Promise<{ order: Order; pointsRefunded: number; email?: string } | null> {
    const keys = await redis.keys('user:*:orders');
    for (const key of keys) {
        const orders = (await redis.get<Order[]>(key)) || [];
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx === -1) continue;

        const userId = key.split(':')[1];
        const order = orders[idx];
        let pointsRefunded = 0;

        // Refund points once (guard against double refund on an already-refunded order).
        if (isRefund && order.status !== 'refunded' && order.pointsSpent > 0) {
            pointsRefunded = order.pointsSpent;
            const balance = (await redis.get<number>(`user:${userId}:pointsBalance`)) ?? 0;
            const txns = (await redis.get<PointsTransaction[]>(`user:${userId}:pointsTransactions`)) || [];
            const refundTxn: PointsTransaction = {
                id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                amount: pointsRefunded,
                type: 'refund',
                description: `Order #${orderId.slice(-8)} refunded`,
                timestamp: new Date(),
                orderId,
            };
            await Promise.all([
                redis.set(`user:${userId}:pointsBalance`, balance + pointsRefunded),
                redis.set(`user:${userId}:pointsTransactions`, [refundTxn, ...txns]),
            ]);
        }

        const updatedOrder: Order = {
            ...order,
            status: newStatus,
            statusHistory: [...(order.statusHistory || []), historyEntry(newStatus, message)],
        };
        orders[idx] = updatedOrder;
        await redis.set(key, orders);

        // Best-effort email lookup: the user's email isn't stored per-order for
        // students, so fall back to the order's checkoutData email if present.
        const email = extractEmail(updatedOrder);
        return { order: updatedOrder, pointsRefunded, email };
    }
    return null;
}

function extractEmail(order: Order): string | undefined {
    for (const v of Object.values(order.checkoutData || {})) {
        if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
    }
    return undefined;
}
