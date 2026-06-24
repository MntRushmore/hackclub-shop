import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../../lib/adminAuth';
import { receivePO, getPO } from '../../../../../../../lib/sourcing';
import { mirrorPurchaseOrder } from '../../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../../lib/auditLog';

/**
 * Receive a PO: post every line through the costing ledger (weighted-average cost +
 * stock bump) and flip the PO to `received`. Idempotent — each line uses a
 * deterministic receipt id, so a re-submit posts nothing twice.
 *
 * Gated on `canManageFinance` (not just `canManageSourcing`): receiving moves cost
 * basis and inventory valuation, which is finance-trusted territory.
 */
export async function POST(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canFinance = await requireAdminPermission(session, 'canManageFinance');
    if (!canFinance.allowed) {
        return NextResponse.json(
            { error: 'Receiving a PO requires finance permission' },
            { status: 403 },
        );
    }

    const before = await getPO(params.id);
    if (!before) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const result = await receivePO(params.id, {
        actorId: session!.user!.id!,
        actorEmail: session?.user?.email || undefined,
    });

    if (!result.ok) {
        // The PO may have been partially updated; reflect that in the mirror.
        const after = await getPO(params.id);
        if (after) void mirrorPurchaseOrder(after);
        return NextResponse.json({ error: result.error }, { status: 409 });
    }

    void mirrorPurchaseOrder(result.po);
    if (!result.alreadyReceived) {
        void recordAudit({
            action: 'sourcing.po.receive',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: result.po.id,
            summary: `Received PO ${result.po.id} (${result.receiptIds.length} line${result.receiptIds.length === 1 ? '' : 's'} posted to ledger)`,
            metadata: { receiptIds: result.receiptIds },
        });
    }

    return NextResponse.json({
        po: result.po,
        receiptIds: result.receiptIds,
        alreadyReceived: result.alreadyReceived || false,
    });
}
