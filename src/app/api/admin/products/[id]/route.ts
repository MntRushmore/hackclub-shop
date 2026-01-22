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
    } catch (error) {
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
        const updated: Product = {
            ...product,
            ...body,
            id: product.id,
            createdAt: product.createdAt,
            updatedAt: new Date(),
        };

        await redis.set(`product:${params.id}`, updated);
        return NextResponse.json({ product: updated });
    } catch (error) {
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
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }
}
