import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Product } from '../../../../types/Admin';
import { mirrorProduct } from '../../../../lib/airtableMirror';
import { getVariantStocks, setStock } from '../../../../lib/inventory';
import { recordAudit } from '../../../../lib/auditLog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Admin inventory view + quick-adjust. Lists every variant across all products
 * with its live stock / reserved / available, and lets staff set a variant's
 * stock number directly (which updates both the product record and the inventory
 * cache, then re-mirrors the product to Airtable so the spreadsheet matches).
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const keys = await redis.keys('product:*');
    const products: Product[] = [];
    for (const key of keys) {
        const p = await redis.get<Product>(key);
        if (p) products.push(p);
    }

    const variantIds = products.flatMap(p =>
        (p.variants || []).map(v => String(v.variant_id || v.id)),
    );
    const stocks = await getVariantStocks(variantIds);

    const rows = products.flatMap(p =>
        (p.variants || []).map(v => {
            const variantId = String(v.variant_id || v.id);
            const s = stocks[variantId];
            return {
                productId: p.id,
                productName: p.name,
                variantId,
                variantName: v.name,
                size: v.size,
                color: v.color,
                stock: s?.stock ?? null,      // null = untracked/unlimited
                reserved: s?.reserved ?? 0,
                available: s?.available ?? null,
            };
        }),
    );

    return NextResponse.json({ rows });
}

export async function PATCH(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { productId, variantId, stock } = (await request.json()) as {
        productId?: string;
        variantId?: string;
        stock?: number | null;
    };
    if (!productId || !variantId) {
        return NextResponse.json({ error: 'productId and variantId are required' }, { status: 400 });
    }

    const product = await redis.get<Product>(`product:${productId}`);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Normalize: empty/negative/NaN → untracked (unlimited).
    const next = stock === null || stock === undefined || Number.isNaN(stock) || stock < 0
        ? undefined
        : Math.floor(stock);

    let matched = false;
    product.variants = (product.variants || []).map(v => {
        if (String(v.variant_id || v.id) === String(variantId)) {
            matched = true;
            return { ...v, stock: next };
        }
        return v;
    });
    if (!matched) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });

    product.updatedAt = new Date();
    await redis.set(`product:${productId}`, product);
    await setStock(variantId, next === undefined ? null : next);
    void mirrorProduct(product);

    void recordAudit({
        action: 'inventory.adjust',
        actorId: session?.user?.id || 'unknown',
        actorEmail: session?.user?.email || undefined,
        target: variantId,
        summary: `Set stock for "${product.name}" variant ${variantId} to ${next === undefined ? 'unlimited' : next}`,
        metadata: { productId, stock: next ?? null },
    });

    return NextResponse.json({ ok: true, stock: next ?? null });
}
