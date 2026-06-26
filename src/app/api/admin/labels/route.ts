import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { getVariantStocks } from '../../../../lib/inventory';
import { recordAudit } from '../../../../lib/auditLog';
import { assignSku, buildSkuCandidate, variantKey } from '../../../../lib/sku';
import { getCatalogProducts } from '../../../../lib/catalog';

/**
 * Labels: the variant picker for the label designer/printer, plus SKU assignment.
 *
 *   GET  → every variant across all products with { sku, suggestedSku, stock } so the
 *          designer can pick what to print and show which variants still need a SKU.
 *   POST { variantId, sku? } → assign/generate a store-unique SKU for one variant
 *          (auto-generate when `sku` omitted), persisting to the variant's Stripe
 *          Price and maintaining the Redis reverse index; audit.
 *
 * Reads the catalog (Stripe-fed) like the storefront. Gated on canManageProducts
 * (printing labels / minting SKUs is a catalog action; it does not touch cost basis).
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const products = await getCatalogProducts();

    const variantIds = products.flatMap(p => (p.variants || []).map(variantKey));
    const stocks = await getVariantStocks(variantIds);

    const rows = products.flatMap(p =>
        (p.variants || []).map(v => {
            const variantId = variantKey(v);
            const s = stocks[variantId];
            return {
                productId: p.id,
                productName: p.name,
                category: p.category,
                draft: !!p.draft,
                variantId,
                variantName: v.name,
                size: v.size,
                color: v.color,
                sku: v.sku || null,
                scanCode: v.scanCode || null,
                suggestedSku: buildSkuCandidate(p, v),
                stock: s?.stock ?? null,
                available: s?.available ?? null,
            };
        }),
    );

    return NextResponse.json({ rows });
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { variantId, sku } = (await request.json()) as {
        variantId?: string;
        sku?: string;
    };
    if (!variantId) {
        return NextResponse.json({ error: 'variantId is required' }, { status: 400 });
    }

    let result;
    try {
        result = await assignSku(variantId, sku);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not assign SKU';
        const status = msg === 'Variant not found' ? 404 : 400;
        return NextResponse.json({ error: msg }, { status });
    }

    if (result.changed) {
        void recordAudit({
            action: 'inventory.sku.assign',
            actorId: session?.user?.id || 'unknown',
            actorEmail: session?.user?.email || undefined,
            target: variantId,
            summary: `Assigned SKU ${result.sku} (barcode ${result.scanCode}) to variant ${variantId}`,
            metadata: { sku: result.sku, scanCode: result.scanCode },
        });
    }

    return NextResponse.json({ ok: true, sku: result.sku, scanCode: result.scanCode, changed: result.changed });
}
