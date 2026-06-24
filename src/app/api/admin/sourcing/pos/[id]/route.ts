import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getPO, setPOStatus, deletePO } from '../../../../../../lib/sourcing';
import { mirrorPurchaseOrder, unmirrorPurchaseOrder } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';
import { PurchaseOrderStatus } from '../../../../../../types/Sourcing';

// `received` is intentionally excluded — it's only reachable via the /receive route,
// which posts stock through the costing ledger first.
const SETTABLE: PurchaseOrderStatus[] = ['issued', 'in_transit', 'cancelled'];

export async function GET(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const po = await getPO(params.id);
    if (!po) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }
    return NextResponse.json({ po });
}

export async function PUT(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const status = body?.status as PurchaseOrderStatus | undefined;
        if (!status || !SETTABLE.includes(status)) {
            return NextResponse.json(
                { error: 'status must be one of: issued, in_transit, cancelled (use /receive to receive)' },
                { status: 400 },
            );
        }

        const result = await setPOStatus(params.id, status);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: 409 });
        }

        void mirrorPurchaseOrder(result.po);
        void recordAudit({
            action: 'sourcing.po.status',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: result.po.id,
            summary: `PO ${result.po.id} → ${status}`,
        });

        return NextResponse.json({ po: result.po });
    } catch {
        return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const po = await getPO(params.id);
        if (!po) {
            return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
        }
        // A received PO has posted stock/cost into the ledger — deleting it would
        // orphan that history. Block it; cancel-then-keep is the right model.
        if (po.status === 'received') {
            return NextResponse.json(
                { error: 'Cannot delete a received PO (its receipts are in the costing ledger)' },
                { status: 409 },
            );
        }

        await deletePO(params.id);
        void unmirrorPurchaseOrder(params.id);
        void recordAudit({
            action: 'sourcing.po.delete',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: params.id,
            summary: `Deleted PO ${params.id}`,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 });
    }
}
