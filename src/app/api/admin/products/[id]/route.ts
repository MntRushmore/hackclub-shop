import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { Product } from '../../../../../types/Admin';
import { mirrorProduct, unmirrorProduct } from '../../../../../lib/airtableMirror';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const product = await redis.get<Product>(`product:${params.id}`);
        if (!product) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }

        return NextResponse.json({ product });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const product = await redis.get<Product>(`product:${params.id}`);
        if (!product) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }

        const body = await request.json();
        const { variants, ...rest } = body;

        // Transform variants to the dual-price model (cash for adults, points for students).
        const transformedVariants = variants ? (variants || []).map((v: any, idx: number) => {
            const cash = v.priceCash != null && v.priceCash !== '' ? parseFloat(v.priceCash) : undefined;
            const points = v.pricePoints != null && v.pricePoints !== '' ? parseInt(v.pricePoints) : undefined;
            const variant: any = {
                id: v.id || product.variants?.[idx]?.id || `var_${Date.now()}_${idx}`,
                variant_id: v.variant_id || product.variants?.[idx]?.variant_id || `var_${Date.now()}_${idx}`,
                name: v.name,
                price: cash ?? parseFloat(v.price || '0'),
                size: v.size,
                color: v.color,
                image_url: v.image_url,
                stock: v.stock ? parseInt(v.stock) : undefined,
                weightOz: v.weightOz != null && v.weightOz !== '' ? parseFloat(v.weightOz) : undefined,
            };

            // Unit cost: a submitted value wins; otherwise preserve any existing
            // cost on the variant (the receiving ledger may have set a weighted
            // average we don't want a plain product edit to wipe). Matched by
            // index, then by id as a fallback if the order shifted.
            const submittedCost = v.unitCost != null && v.unitCost !== '' && !Number.isNaN(parseFloat(v.unitCost))
                ? Math.max(0, parseFloat(v.unitCost))
                : undefined;
            const priorVariant = product.variants?.[idx]?.variant_id === variant.variant_id
                ? product.variants?.[idx]
                : (product.variants || []).find((pv: any) => pv.variant_id === variant.variant_id || pv.id === variant.id);
            const priorCost = (priorVariant as any)?.unitCost;
            if (submittedCost !== undefined) variant.unitCost = submittedCost;
            else if (typeof priorCost === 'number') variant.unitCost = priorCost;

            if (cash !== undefined && cash > 0) variant.price_cash = cash;
            if (points !== undefined && points > 0) variant.price_points = points;

            return variant;
        }) : product.variants;

        const shippingOptions = body.shippingOptions
            ? (body.shippingOptions || []).map((s: any, idx: number) => ({
                  id: s.id || `ship_${Date.now()}_${idx}`,
                  country: s.country,
                  cost: parseFloat(s.cost),
                  costPoints: s.costPoints ? parseInt(s.costPoints) : undefined,
              }))
            : product.shippingOptions;

        const updated: Product = {
            ...product,
            ...rest,
            variants: transformedVariants,
            shippingOptions,
            id: product.id,
            createdAt: product.createdAt,
            updatedAt: new Date(),
        };

        await redis.set(`product:${params.id}`, updated);
        void mirrorProduct(updated);
        return NextResponse.json({ product: updated });
    } catch (error) {
        console.error('Update error:', error);
        return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        await redis.del(`product:${params.id}`);
        void unmirrorProduct(params.id);
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }
}
