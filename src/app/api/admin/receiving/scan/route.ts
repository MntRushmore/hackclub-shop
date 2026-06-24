import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { receiveStock } from '../../../../../lib/costing';
import { receivePOLine } from '../../../../../lib/sourcing';

/**
 * Scan-to-receive (Slice B). One resolved variant → stock + weighted-avg cost move
 * through `receiveStock` (the ONLY costing path). Two modes:
 *
 *  - **PO reconcile** (`poId` present): posts through `receivePOLine`, which uses the
 *    deterministic id `{poId}__{variantId}` — so a scan and a "Receive PO" click can't
 *    double-count — and flips the PO to `received` once all lines are in.
 *  - **Free receive** (no `poId`): posts through `receiveStock` with a client-supplied
 *    `receiptId` so a double-tap / retry is idempotent.
 *
 * Gated on canManageFinance (it moves cost basis + inventory valuation).
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const body = (await request.json()) as {
        productId?: string;
        variantId?: string;
        quantity?: number | string;
        unitCost?: number | string;
        poId?: string;
        receiptId?: string;
    };

    const variantId = String(body.variantId || '');
    const quantity = Math.floor(Number(body.quantity));
    const unitCost = Number(body.unitCost);
    if (!variantId) return NextResponse.json({ error: 'variantId is required' }, { status: 400 });
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: 'Quantity must be a positive whole number' }, { status: 400 });
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
        return NextResponse.json({ error: 'Unit cost must be zero or more' }, { status: 400 });
    }

    const actor = { actorId: session?.user?.id || 'unknown', actorEmail: session?.user?.email || undefined };

    // ── PO reconcile ──────────────────────────────────────────────────────────────
    if (body.poId) {
        const res = await receivePOLine(String(body.poId), variantId, actor, { quantity, unitCost });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
        return NextResponse.json({
            ok: true,
            mode: 'po',
            receiptId: res.receiptId,
            duplicate: res.duplicate,
            poId: res.po.id,
            poStatus: res.po.status,
            poCompleted: res.poCompleted,
        });
    }

    // ── Free receive ──────────────────────────────────────────────────────────────
    if (!body.productId) return NextResponse.json({ error: 'productId is required for a free receive' }, { status: 400 });

    const res = await receiveStock({
        productId: String(body.productId),
        variantId,
        quantity,
        unitCost,
        note: 'Scanned receive',
        actorId: actor.actorId,
        actorEmail: actor.actorEmail,
        receiptId: body.receiptId,   // client-supplied → idempotent on retry
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

    return NextResponse.json({
        ok: true,
        mode: 'free',
        receiptId: res.receipt.id,
        duplicate: res.duplicate === true,
        stockAfter: res.receipt.stockAfter,
        avgCostAfter: res.receipt.avgCostAfter,
    });
}
