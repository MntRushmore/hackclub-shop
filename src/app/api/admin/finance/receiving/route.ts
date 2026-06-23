import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { receiveStock, readReceipts, readVariantReceipts } from '../../../../../lib/costing';

/**
 * Stock receiving (purchase) ledger.
 *   GET  ?variantId=…   → that variant's receipt history (or recent across all).
 *   POST { productId, variantId, quantity, unitCost, note?, receiptId? }
 *        → record a receipt: blends the weighted-average cost, bumps stock,
 *          audits, and re-mirrors to Airtable.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { searchParams } = new URL(request.url);
        const variantId = searchParams.get('variantId');
        const receipts = variantId ? await readVariantReceipts(variantId, 100) : await readReceipts(100);
        return NextResponse.json({ receipts });
    } catch (err) {
        console.error('[finance/receiving] GET failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to load receipts' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    let body: {
        productId?: string;
        variantId?: string;
        quantity?: number | string;
        unitCost?: number | string;
        note?: string;
        receiptId?: string;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const result = await receiveStock({
        productId: String(body.productId || ''),
        variantId: String(body.variantId || ''),
        quantity: Number(body.quantity),
        unitCost: Number(body.unitCost),
        note: body.note,
        receiptId: body.receiptId,
        actorId: session?.user?.id || 'unknown',
        actorEmail: session?.user?.email || undefined,
    });

    if (!result.ok) {
        const code = result.error === 'Product not found' || result.error === 'Variant not found' ? 404 : 400;
        return NextResponse.json({ error: result.error }, { status: code });
    }
    return NextResponse.json(result);
}
