import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { Product } from '../../../../../types/Admin';
import { resolveScan, variantKey } from '../../../../../lib/sku';
import { getVariantStock } from '../../../../../lib/inventory';
import { readVariantReceipts } from '../../../../../lib/costing';
import { listPOs } from '../../../../../lib/sourcing';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Resolve a scanned/typed SKU → everything the receive screen needs in one call:
 * the variant, its current on-hand/available, a unit-cost prefill (the open PO line's
 * planned cost, else the last receipt's cost), and the open PO line if one matches —
 * so scanning a box can reconcile against the purchase order it belongs to.
 *
 * Gated on canManageFinance (it surfaces cost basis), mirroring the receiving endpoint.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    // Accept whatever the scanner emits: the short barcode code OR the full SKU.
    const scanned = (searchParams.get('code') || searchParams.get('sku') || '').trim();
    if (!scanned) return NextResponse.json({ error: 'code is required' }, { status: 400 });

    const variantId = await resolveScan(scanned);
    if (!variantId) {
        return NextResponse.json(
            { error: 'unknown', message: 'Nothing matches that barcode. Generate a label for it first (Labels).' },
            { status: 404 },
        );
    }

    // Find the product + variant that owns this variant id.
    let product: Product | null = null;
    let variantName = '';
    let productId = '';
    try {
        const keys = await redis.keys('product:*');
        for (const key of keys) {
            const p = await redis.get<Product>(key);
            if (!p) continue;
            const v = (p.variants || []).find((x) => variantKey(x) === String(variantId));
            if (v) { product = p; productId = p.id; variantName = v.name; break; }
        }
    } catch (err) {
        console.error('[receiving/resolve] product scan failed:', err instanceof Error ? err.message : err);
    }
    if (!product) {
        // SKU index points at a variant that no longer exists (deleted product). Stale.
        return NextResponse.json(
            { error: 'stale', message: 'That SKU points at a variant that no longer exists.' },
            { status: 404 },
        );
    }

    const variant = (product.variants || []).find((x) => variantKey(x) === String(variantId))!;

    const [stock, receipts] = await Promise.all([
        getVariantStock(String(variantId)).catch(() => ({ stock: null, reserved: 0, available: null })),
        readVariantReceipts(String(variantId), 1).catch(() => []),
    ]);

    // Find an open PO with a line for this variant (the reconciliation target).
    let openPO: { poId: string; quantity: number; unitCost: number; description: string } | null = null;
    try {
        const pos = await listPOs();
        for (const po of pos) {
            if (po.status === 'received' || po.status === 'cancelled') continue;
            const line = po.lines.find((l) => String(l.variantId) === String(variantId));
            if (line) {
                openPO = { poId: po.id, quantity: line.quantity, unitCost: line.unitCost, description: line.description };
                break; // newest first (listPOs is newest-first); take the freshest open PO
            }
        }
    } catch (err) {
        console.error('[receiving/resolve] PO scan failed:', err instanceof Error ? err.message : err);
    }

    // Unit-cost prefill: the open PO line's planned cost wins, else the last receipt,
    // else the variant's current weighted-avg cost.
    const lastReceiptUnitCost = receipts[0]?.unitCost;
    const unitCostPrefill = openPO?.unitCost
        ?? lastReceiptUnitCost
        ?? (typeof variant.unitCost === 'number' ? variant.unitCost : undefined);

    return NextResponse.json({
        ok: true,
        sku: variant.sku || scanned,
        scanCode: variant.scanCode || null,
        productId,
        productName: product.name,
        variantId: String(variantId),
        variantName,
        size: variant.size,
        color: variant.color,
        onHand: stock.stock,           // null = untracked/unlimited
        available: stock.available,
        currentUnitCost: typeof variant.unitCost === 'number' ? variant.unitCost : null,
        lastReceiptUnitCost: lastReceiptUnitCost ?? null,
        unitCostPrefill: unitCostPrefill ?? null,
        openPO,
    });
}
