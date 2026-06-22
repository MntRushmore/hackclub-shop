import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { Coupon } from '../../../../../types/Admin';
import { mirrorCoupon, unmirrorCoupon } from '../../../../../lib/airtableMirror';

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
        const coupon = await redis.get<Coupon>(`coupon:${params.id}`);
        if (!coupon) {
            return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
        }

        return NextResponse.json({ coupon });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch coupon' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageCoupons');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const coupon = await redis.get<Coupon>(`coupon:${params.id}`);
        if (!coupon) {
            return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
        }

        const body = await request.json();
        const updated: Coupon = {
            ...coupon,
            ...body,
            id: coupon.id,
            createdAt: coupon.createdAt,
        };

        await redis.set(`coupon:${params.id}`, updated);
        await redis.set(`coupon:${updated.code}`, updated);
        void mirrorCoupon(updated);
        return NextResponse.json({ coupon: updated });
    } catch {
        return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageCoupons');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const coupon = await redis.get<Coupon>(`coupon:${params.id}`);
        if (!coupon) {
            return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
        }

        await redis.del(`coupon:${params.id}`);
        await redis.del(`coupon:${coupon.code}`);
        void unmirrorCoupon(params.id);
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete coupon' }, { status: 500 });
    }
}
