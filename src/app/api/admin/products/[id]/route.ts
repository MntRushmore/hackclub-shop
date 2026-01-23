import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { Product } from '../../../../../types/Admin';

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

        // Transform variants with payment mode support
        const transformedVariants = variants ? (variants || []).map((v: any, idx: number) => {
            const variant: any = {
                id: v.id || product.variants?.[idx]?.id || `var_${Date.now()}_${idx}`,
                variant_id: v.variant_id || product.variants?.[idx]?.variant_id || `var_${Date.now()}_${idx}`,
                name: v.name,
                price: parseFloat(v.price || '0'),
                payment_mode: v.paymentMode || 'balance_only',
                size: v.size,
                color: v.color,
                image_url: v.image_url,
                stock: v.stock ? parseInt(v.stock) : undefined,
            };

            // Set appropriate price fields based on payment mode
            if (v.paymentMode === 'balance_only') {
                variant.price_balance = parseFloat(v.priceBalance || v.price || '0');
            } else if (v.paymentMode === 'points_only') {
                variant.price_points = parseInt(v.pricePoints || '0');
            } else if (v.paymentMode === 'mixed') {
                variant.price_balance_full = parseFloat(v.priceBalanceFull || '0');
                variant.price_points_full = parseInt(v.pricePointsFull || '0');
            }

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
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }
}
