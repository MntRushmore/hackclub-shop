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
    } catch (error) {
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

        const product: Product = {
            id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            description,
            image_url,
            thumbnail_url,
            category,
            variants: (variants || []).map((v: any, idx: number) => ({
                id: v.id || `var_${Date.now()}_${idx}`,
                variant_id: v.variant_id || `var_${Date.now()}_${idx}`,
                name: v.name,
                price: parseFloat(v.price),
                size: v.size,
                color: v.color,
                image_url: v.image_url,
                stock: v.stock ? parseInt(v.stock) : undefined,
            })),
            shippingOptions: (body.shippingOptions || []).map((s: any, idx: number) => ({
                id: s.id || `ship_${Date.now()}_${idx}`,
                country: s.country,
                cost: parseFloat(s.cost),
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
