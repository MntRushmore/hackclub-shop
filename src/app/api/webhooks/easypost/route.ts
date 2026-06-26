import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { findOrderByTracker, patchOrder, orderEmail } from '../../../../lib/orderStore';
import { mirrorOrder } from '../../../../lib/airtableMirror';
import { sendEmail, buildStatusUpdate } from '../../../../lib/email';
import { recordAudit } from '../../../../lib/auditLog';

/**
 * EasyPost tracker webhook — the carrier-driven signal that an order was
 * delivered. When a label is bought (`src/lib/shipping.ts` → `buyLabel`) we save
 * the EasyPost tracker id on the order and index it (`tracker:${id}` → orderId).
 * EasyPost then POSTs `tracker.updated` events here as the package moves; on a
 * `delivered` status we advance the order: fulfilled → delivered + email + mirror.
 *
 * Auth: EasyPost signs the raw body with an HMAC-SHA256 secret you configure on
 * the webhook (Dashboard → Webhooks). We verify it against EASYPOST_WEBHOOK_SECRET
 * when set. If the secret is unset we accept unsigned events (dev/initial setup)
 * but log a warning — set the secret in production.
 */

export const runtime = 'nodejs';

interface EpWebhookEvent {
    description?: string;          // e.g. "tracker.updated"
    result?: {
        id?: string;               // tracker id
        status?: string;           // "delivered", "in_transit", …
    };
}

function verifySignature(rawBody: string, header: string | null): boolean {
    const secret = process.env.EASYPOST_WEBHOOK_SECRET;
    if (!secret) {
        console.warn('[EasyPost webhook] EASYPOST_WEBHOOK_SECRET not set — accepting unsigned event');
        return true;
    }
    if (!header) return false;
    // EasyPost sends "hmac-sha256-hex=<hex>" in X-Hmac-Signature.
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const provided = header.replace(/^hmac-sha256-hex=/, '').trim();
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

export async function POST(request: Request) {
    const rawBody = await request.text();
    const sig = request.headers.get('x-hmac-signature');
    if (!verifySignature(rawBody, sig)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    let event: EpWebhookEvent;
    try {
        event = JSON.parse(rawBody) as EpWebhookEvent;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    try {
        // Only act on a tracker delivery scan.
        if (event.description !== 'tracker.updated' || event.result?.status !== 'delivered') {
            return NextResponse.json({ received: true });
        }
        const trackerId = event.result?.id;
        if (!trackerId) return NextResponse.json({ received: true });

        const order = await findOrderByTracker(trackerId);
        if (!order) {
            console.warn('[EasyPost webhook] No order for tracker', trackerId);
            return NextResponse.json({ received: true });
        }
        // Idempotent + only advance a shipped order. A refunded/already-delivered
        // order is left alone (a duplicate scan or a late event must not resurrect it).
        if (order.status !== 'fulfilled') {
            return NextResponse.json({ received: true });
        }

        const updated = await patchOrder(order.id, {
            status: 'delivered',
            ...(order.shipment ? { shipment: { ...order.shipment, deliveredAt: new Date() } } : {}),
            statusHistory: [
                ...(order.statusHistory || []),
                { status: 'delivered', timestamp: new Date(), message: 'Carrier confirmed delivery' },
            ],
        });

        if (updated) {
            void mirrorOrder(updated);
            const to = orderEmail(updated);
            if (to) void sendEmail(buildStatusUpdate(updated, to));
            void recordAudit({
                action: 'order.mark-delivered',
                actorId: 'system:easypost',
                target: order.id,
                summary: `Order #${order.id.slice(-8)} delivered (carrier confirmed)`,
                metadata: { trackerId },
            });
        }
        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('[EasyPost webhook] Handler error:', error);
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }
}
