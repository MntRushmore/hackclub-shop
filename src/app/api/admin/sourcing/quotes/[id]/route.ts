import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getQuote, updateQuote, deleteQuote } from '../../../../../../lib/sourcing';
import { mirrorQuote, unmirrorQuote } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';
import { QuotePriceBreak, QuoteStatus } from '../../../../../../types/Sourcing';

const VALID_STATUS: QuoteStatus[] = ['open', 'accepted', 'rejected', 'expired'];

function parseBreaks(raw: unknown): QuotePriceBreak[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    return raw
        .map((b) => ({
            minQty: Number((b as QuotePriceBreak)?.minQty),
            unitCost: Number((b as QuotePriceBreak)?.unitCost),
        }))
        .filter((b) => Number.isFinite(b.minQty) && Number.isFinite(b.unitCost) && b.minQty > 0);
}

function optNum(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function GET(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const quote = await getQuote(params.id);
    if (!quote) {
        return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }
    return NextResponse.json({ quote });
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

        if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const updated = await updateQuote(params.id, {
            itemName: body.itemName !== undefined ? String(body.itemName).trim() : undefined,
            productId: body.productId !== undefined ? String(body.productId).trim() || undefined : undefined,
            variantHint:
                body.variantHint !== undefined ? String(body.variantHint).trim() || undefined : undefined,
            priceBreaks: parseBreaks(body.priceBreaks),
            moq: body.moq !== undefined ? optNum(body.moq) : undefined,
            leadTimeDays: body.leadTimeDays !== undefined ? optNum(body.leadTimeDays) : undefined,
            setupFee: body.setupFee !== undefined ? optNum(body.setupFee) : undefined,
            shippingEstimate:
                body.shippingEstimate !== undefined ? optNum(body.shippingEstimate) : undefined,
            currency: body.currency !== undefined ? String(body.currency).trim() || 'USD' : undefined,
            validUntil: body.validUntil !== undefined ? String(body.validUntil).trim() || undefined : undefined,
            notes: body.notes !== undefined ? String(body.notes).trim() || undefined : undefined,
            status: body.status,
        });

        if (!updated) {
            return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
        }

        void mirrorQuote(updated);
        void recordAudit({
            action: 'sourcing.quote.update',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: updated.id,
            summary: body.status
                ? `Set quote "${updated.itemName}" to ${updated.status}`
                : `Updated quote "${updated.itemName}"`,
        });

        return NextResponse.json({ quote: updated });
    } catch {
        return NextResponse.json({ error: 'Failed to update quote' }, { status: 500 });
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
        const quote = await getQuote(params.id);
        if (!quote) {
            return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
        }

        await deleteQuote(params.id);
        void unmirrorQuote(params.id);
        void recordAudit({
            action: 'sourcing.quote.delete',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: params.id,
            summary: `Deleted quote "${quote.itemName}"`,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete quote' }, { status: 500 });
    }
}
