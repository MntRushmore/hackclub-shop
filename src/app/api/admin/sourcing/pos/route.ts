import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { createPO, listPOs, listPOsByVendor, getVendor, getQuote } from '../../../../../lib/sourcing';
import { mirrorPurchaseOrder } from '../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../lib/auditLog';
import { POLine } from '../../../../../types/Sourcing';

function parseLines(raw: unknown): POLine[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((l) => ({
            productId: String((l as POLine)?.productId || ''),
            variantId: String((l as POLine)?.variantId || ''),
            description: String((l as POLine)?.description || ''),
            quantity: Math.floor(Number((l as POLine)?.quantity)),
            unitCost: Number((l as POLine)?.unitCost),
        }))
        .filter(
            (l) =>
                l.productId &&
                l.variantId &&
                Number.isFinite(l.quantity) &&
                l.quantity > 0 &&
                Number.isFinite(l.unitCost) &&
                l.unitCost >= 0,
        );
}

function optNum(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');
        const pos = vendorId ? await listPOsByVendor(vendorId) : await listPOs();
        return NextResponse.json({ pos });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch purchase orders' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const vendorId = typeof body.vendorId === 'string' ? body.vendorId : '';
        const lines = parseLines(body.lines);

        if (!vendorId) {
            return NextResponse.json({ error: 'Vendor is required' }, { status: 400 });
        }
        if (lines.length === 0) {
            return NextResponse.json(
                { error: 'At least one line (product, variant, quantity, unit cost) is required' },
                { status: 400 },
            );
        }

        const vendor = await getVendor(vendorId);
        if (!vendor) {
            return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
        }
        if (body.quoteId) {
            const quote = await getQuote(String(body.quoteId));
            if (!quote) {
                return NextResponse.json({ error: 'Linked quote not found' }, { status: 404 });
            }
        }

        // Allow issuing straight away from the UI ("Issue PO"), else default to draft.
        const status = body.status === 'issued' ? 'issued' : 'draft';

        const po = await createPO({
            vendorId,
            quoteId: body.quoteId ? String(body.quoteId) : undefined,
            lines,
            setupFee: optNum(body.setupFee),
            shippingCost: optNum(body.shippingCost),
            expectedDate: body.expectedDate ? String(body.expectedDate) : undefined,
            issuedBy: status === 'issued' ? session!.user!.id! : undefined,
            status,
        });

        void mirrorPurchaseOrder(po);
        void recordAudit({
            action: 'sourcing.po.create',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: po.id,
            summary: `Created PO ${po.id} for ${vendor.name} (${po.lines.length} line${po.lines.length === 1 ? '' : 's'}, ${status})`,
        });

        return NextResponse.json({ po }, { status: 201 });
    } catch (err) {
        console.error('[sourcing/pos]', err);
        return NextResponse.json({ error: 'Failed to create purchase order' }, { status: 500 });
    }
}
