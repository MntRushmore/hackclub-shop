import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import {
    createQuote,
    listQuotes,
    listQuotesByVendor,
    listQuotesByProduct,
    getVendor,
} from '../../../../../lib/sourcing';
import { mirrorQuote } from '../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../lib/auditLog';
import { QuotePriceBreak } from '../../../../../types/Sourcing';

function parseBreaks(raw: unknown): QuotePriceBreak[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((b) => ({
            minQty: Number((b as QuotePriceBreak)?.minQty),
            unitCost: Number((b as QuotePriceBreak)?.unitCost),
        }))
        .filter((b) => Number.isFinite(b.minQty) && Number.isFinite(b.unitCost) && b.minQty > 0);
}

function optNum(v: unknown): number | undefined {
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
        const productId = searchParams.get('productId');

        let quotes;
        if (vendorId) quotes = await listQuotesByVendor(vendorId);
        else if (productId) quotes = await listQuotesByProduct(productId);
        else quotes = await listQuotes();

        return NextResponse.json({ quotes });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
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
        const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
        const priceBreaks = parseBreaks(body.priceBreaks);

        if (!vendorId || !itemName) {
            return NextResponse.json(
                { error: 'Vendor and item name are required' },
                { status: 400 },
            );
        }
        if (priceBreaks.length === 0) {
            return NextResponse.json(
                { error: 'At least one price break (quantity + unit cost) is required' },
                { status: 400 },
            );
        }

        const vendor = await getVendor(vendorId);
        if (!vendor) {
            return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
        }

        const quote = await createQuote({
            vendorId,
            itemName,
            productId: body.productId?.trim() || undefined,
            variantHint: body.variantHint?.trim() || undefined,
            priceBreaks,
            moq: optNum(body.moq),
            leadTimeDays: optNum(body.leadTimeDays),
            setupFee: optNum(body.setupFee),
            shippingEstimate: optNum(body.shippingEstimate),
            currency: body.currency?.trim() || 'USD',
            validUntil: body.validUntil?.trim() || undefined,
            notes: body.notes?.trim() || undefined,
        });

        void mirrorQuote(quote);
        void recordAudit({
            action: 'sourcing.quote.create',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: quote.id,
            summary: `Logged quote "${quote.itemName}" from ${vendor.name}`,
        });

        return NextResponse.json({ quote }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
    }
}
