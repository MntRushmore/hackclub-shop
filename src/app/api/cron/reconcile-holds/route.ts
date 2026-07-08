import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getStripe, isStripeConfigured } from '../../../../lib/stripe';
import { deleteGuestOrder } from '../../../../lib/guestOrders';
import { release, claimOrderSettlement } from '../../../../lib/inventory';
import { Order } from '../../../../types/Order';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Inventory-hold reconciliation cron (daily via Vercel Cron, see vercel.json).
 *
 * A guest checkout reserves stock when the Stripe session is created, and the
 * `checkout.session.expired` webhook releases it if the guest never pays. If
 * that single webhook delivery is lost (endpoint down, deploy in progress,
 * Stripe drop), the reservation is held forever and the variant reads as
 * phantom-out-of-stock. This sweep is the safety net: any guest Stripe order
 * still `unpaid` well past its session's 30-minute expiry is treated exactly
 * like the expiry webhook would have — release the hold (one-time claim so a
 * duplicate can never double-release) and delete the never-paid record.
 *
 * Safety valve: when Stripe is reachable, the session is re-read first. If it
 * somehow reports paid (a MISSED completion webhook, not a missed expiry), the
 * order is left alone and reported so a human finalizes it — this sweep must
 * never delete money.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Without the
 * env set, the route refuses to run (fail closed).
 */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Sessions expire 30 min after creation; 2 hours is unambiguously dead.
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;

    let swept = 0;
    let released = 0;
    const needsHuman: string[] = [];

    try {
        const keys = await redis.keys('order:*');
        for (const key of keys) {
            const order = await redis.get<Order>(key);
            if (!order || order.pathway !== 'guest') continue;
            if (order.paymentMethod !== 'stripe' || !order.stripeSessionId) continue;
            if (order.paymentStatus !== 'unpaid') continue;
            if (new Date(order.createdAt).getTime() > cutoff) continue;

            // Double-check with Stripe before destroying anything: a missed
            // COMPLETION webhook looks identical from Redis alone.
            const mode = order.stripeMode || 'live';
            if (isStripeConfigured(mode)) {
                try {
                    const session = await getStripe(mode).checkout.sessions.retrieve(order.stripeSessionId);
                    if (session.payment_status === 'paid') {
                        needsHuman.push(order.id);
                        console.error('[reconcile-holds] Order', order.id, 'is PAID on Stripe but unpaid locally — missed completion webhook, finalize manually.');
                        continue;
                    }
                } catch {
                    // Session unreadable (deleted test data, wrong slot). The
                    // 2h age bound still makes expiry certain; proceed.
                }
            }

            if (order.inventoryHold && order.inventoryHold.length > 0) {
                if (await claimOrderSettlement(order.id)) {
                    await release(order.inventoryHold);
                    released += order.inventoryHold.reduce((s, l) => s + l.quantity, 0);
                }
            }
            await deleteGuestOrder(order.id);
            swept += 1;
        }

        return NextResponse.json({ ok: true, swept, unitsReleased: released, needsHuman });
    } catch (error) {
        console.error('[reconcile-holds] Error:', error);
        return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
    }
}
