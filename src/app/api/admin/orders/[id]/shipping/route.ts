import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { findOrder, patchOrder, orderEmail } from '../../../../../../lib/orderStore';
import { mirrorOrder } from '../../../../../../lib/airtableMirror';
import { sendEmail, buildStatusUpdate } from '../../../../../../lib/email';
import {
    getRates,
    buyLabel,
    isShippingConfigured,
    fallbackTrackingUrl,
    ParcelSpec,
} from '../../../../../../lib/shipping';
import { recordAudit } from '../../../../../../lib/auditLog';
import { OrderShipment, OrderStatusUpdate } from '../../../../../../types/Order';

/**
 * Shipping / postage actions for one order (Pirate Ship ⇄ EasyPost).
 *
 *   GET  → fetch buyable rates for the order's destination address.
 *   POST { action: 'buy', rateId?, shipmentId, parcel? }
 *        → buy postage, persist tracking to the order, mark it fulfilled,
 *          email the customer with the tracking link.
 *   POST { action: 'manual', carrier?, service?, trackingNumber }
 *        → record a tracking number bought manually in Pirate Ship, same
 *          fulfillment + email side effects, no EasyPost call.
 *
 * Gated on canManageBalance to match the rest of order management.
 */

function historyEntry(message?: string): OrderStatusUpdate {
    return { status: 'fulfilled', timestamp: new Date(), ...(message ? { message } : {}) };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageBalance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    if (!isShippingConfigured()) {
        return NextResponse.json({ configured: false, rates: [] });
    }

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (!order.shippingAddress) {
        return NextResponse.json({ error: 'Order has no structured shipping address' }, { status: 400 });
    }

    const url = new URL(request.url);
    const parcel: ParcelSpec = {
        weightOz: numParam(url, 'weightOz'),
        lengthIn: numParam(url, 'lengthIn'),
        widthIn: numParam(url, 'widthIn'),
        heightIn: numParam(url, 'heightIn'),
    };

    const result = await getRates(order.shippingAddress, parcel);
    if (!result.ok) {
        return NextResponse.json(
            { configured: true, rates: [], error: result.message || 'Could not fetch rates' },
            { status: result.reason === 'not_configured' ? 200 : 502 },
        );
    }
    return NextResponse.json({ configured: true, shipmentId: result.shipmentId, rates: result.rates });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageBalance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const body = (await request.json()) as {
        action: 'buy' | 'manual';
        rateId?: string;
        shipmentId?: string;
        carrier?: string;
        service?: string;
        trackingNumber?: string;
        message?: string;
    };

    let shipment: OrderShipment;

    if (body.action === 'buy') {
        if (!body.shipmentId) {
            return NextResponse.json({ error: 'shipmentId is required to buy a label' }, { status: 400 });
        }
        const bought = await buyLabel(body.shipmentId, body.rateId);
        if (!bought.ok) {
            return NextResponse.json(
                { error: bought.message || 'Label purchase failed' },
                { status: bought.reason === 'not_configured' ? 400 : 502 },
            );
        }
        shipment = {
            carrier: bought.carrier,
            service: bought.service,
            trackingNumber: bought.trackingNumber,
            trackingUrl: bought.trackingUrl || (bought.trackingNumber ? fallbackTrackingUrl(bought.carrier, bought.trackingNumber) : undefined),
            labelUrl: bought.labelUrl,
            easypostShipmentId: bought.shipmentId,
            cost: bought.cost,
            estDeliveryDate: bought.estDeliveryDate,
            shippedAt: new Date(),
        };
    } else if (body.action === 'manual') {
        if (!body.trackingNumber) {
            return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
        }
        shipment = {
            carrier: body.carrier,
            service: body.service,
            trackingNumber: body.trackingNumber,
            trackingUrl: fallbackTrackingUrl(body.carrier, body.trackingNumber),
            shippedAt: new Date(),
        };
    } else {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Buying postage fulfills the order: persist shipment + flip status.
    const updated = await patchOrder(params.id, {
        shipment,
        status: 'fulfilled',
        statusHistory: [...(order.statusHistory || []), historyEntry(body.message)],
    });
    if (!updated) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    void mirrorOrder(updated);
    const to = orderEmail(updated);
    if (to) void sendEmail(buildStatusUpdate(updated, to, body.message));

    void recordAudit({
        action: 'order.ship',
        actorId: session?.user?.id || 'unknown',
        actorEmail: session?.user?.email || undefined,
        target: params.id,
        summary: `Shipped order #${params.id.slice(-8)} via ${shipment.carrier || 'manual'}${shipment.trackingNumber ? ` (${shipment.trackingNumber})` : ''}`,
        metadata: { mode: body.action, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, cost: shipment.cost },
    });

    return NextResponse.json({ order: updated });
}

function numParam(url: URL, key: string): number | undefined {
    const v = url.searchParams.get(key);
    if (v == null || v === '') return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
}
