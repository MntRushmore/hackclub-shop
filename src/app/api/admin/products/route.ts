import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Product } from '../../../../types/Admin';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const keys = await redis.keys('product:*');
        const products: Product[] = [];

        for (const key of keys) {
            const product = await redis.get<Product>(key);
            if (product) products.push(product);
        }

        return NextResponse.json({ products });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const {
            name,
            description,
            image_url,
            thumbnail_url,
            category,
            variants,
        } = body;

        if (!name || !variants || variants.length === 0) {
            return NextResponse.json({ error: 'Missing required fields (need name and at least 1 variant)' }, { status: 400 });
        }

        const variantsInvalid = variants.some((v: any) => {
            if (!v.name) return true;
            // Validate based on payment mode
            if (v.paymentMode === 'balance_only' && !v.price && !v.priceBalance) return true;
            if (v.paymentMode === 'points_only' && !v.pricePoints) return true;
            if (v.paymentMode === 'mixed' && (!v.priceBalanceFull || !v.pricePointsFull)) return true;
            return false;
        });
        if (variantsInvalid) {
            return NextResponse.json({ error: 'Each variant must have a name and valid prices for its payment mode' }, { status: 400 });
        }

        const product: Product = {
            id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            description,
            image_url,
            thumbnail_url,
            category,
            variants: (variants || []).map((v: any, idx: number) => {
                const variant: any = {
                    id: v.id || `var_${Date.now()}_${idx}`,
                    variant_id: v.variant_id || `var_${Date.now()}_${idx}`,
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
            }),
            shippingOptions: (body.shippingOptions || []).map((s: any, idx: number) => ({
                id: s.id || `ship_${Date.now()}_${idx}`,
                country: s.country,
                cost: parseFloat(s.cost),
                costPoints: s.costPoints ? parseInt(s.costPoints) : undefined,
            })),
            checkoutFields: body.checkoutFields || [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await redis.set(`product:${product.id}`, product);
        return NextResponse.json({ product }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }
}
