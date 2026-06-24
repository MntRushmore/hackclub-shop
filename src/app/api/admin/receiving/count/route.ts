import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { Product } from '../../../../../types/Admin';
import { mirrorProduct } from '../../../../../lib/airtableMirror';
import { setStock } from '../../../../../lib/inventory';
import { recordAudit } from '../../../../../lib/auditLog';
import { variantKey } from '../../../../../lib/sku';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Cycle-count correction (Slice C). SETS a variant's stock to the counted number via
 * `setStock` — a stocktake, NOT a purchase. It must NEVER touch cost basis (that's
 * what `receiveStock` is for); conflating the two would corrupt inventory valuation.
 * This is the same write the inventory quick-adjust PATCH does, exposed for the scan
 * screen's count mode, and audited distinctly as `inventory.count`.
 *
 * Gated on canManageProducts (it changes sell-side availability, like the inventory
 * adjust — not finance, because no money/cost moves).
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { productId, variantId, count } = (await request.json()) as {
        productId?: string;
        variantId?: string;
        count?: number | null;
    };
    if (!productId || !variantId) {
        return NextResponse.json({ error: 'productId and variantId are required' }, { status: 400 });
    }

    const product = await redis.get<Product>(`product:${productId}`);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Normalize: empty/negative/NaN → untracked (unlimited), matching the inventory PATCH.
    const next = count === null || count === undefined || Number.isNaN(count) || count < 0
        ? undefined
        : Math.floor(count);

    let matched = false;
    let prior: number | null = null;
    product.variants = (product.variants || []).map((v) => {
        if (variantKey(v) === String(variantId)) {
            matched = true;
            prior = typeof v.stock === 'number' ? v.stock : null;
            return { ...v, stock: next };
        }
        return v;
    });
    if (!matched) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });

    product.updatedAt = new Date();
    await redis.set(`product:${productId}`, product);
    await setStock(String(variantId), next === undefined ? null : next);
    void mirrorProduct(product);

    void recordAudit({
        action: 'inventory.count',
        actorId: session?.user?.id || 'unknown',
        actorEmail: session?.user?.email || undefined,
        target: String(variantId),
        summary: `Cycle-count "${product.name}" variant ${variantId}: ${prior ?? '∞'} → ${next === undefined ? '∞' : next}`,
        metadata: { productId, prior, count: next ?? null },
    });

    return NextResponse.json({ ok: true, count: next ?? null });
}
