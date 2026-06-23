import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Coupon } from '../../../../types/Admin';
import { mirrorCoupon } from '../../../../lib/airtableMirror';

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
        const keys = await redis.keys('coupon:*');
        const couponMap = new Map<string, Coupon>();

        for (const key of keys) {
            const coupon = await redis.get<Coupon>(key);
            if (coupon && coupon.id) {
                couponMap.set(coupon.id, coupon);
            }
        }

        const coupons = Array.from(couponMap.values());
        return NextResponse.json({ coupons });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch coupons' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageCoupons');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const {
            code,
            discountType,
            discountValue,
            usageType,
            usageLimit,
            applicableProducts,
            active,
            expiresAt,
        } = body;

        if (!code || !discountType || !discountValue || !usageType) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (discountType === 'percentage' && (discountValue < 0 || discountValue > 100)) {
            return NextResponse.json({ error: 'Percentage must be 0-100' }, { status: 400 });
        }

        const coupon: Coupon = {
            id: `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            code: code.toUpperCase().trim(),
            discountType,
            discountValue,
            usageType,
            usageLimit: usageType === 'limited' ? usageLimit : undefined,
            usageCount: 0,
            applicableProducts: applicableProducts || [],
            active: active !== false,
            createdAt: new Date(),
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        };

        const existing = await redis.get<Coupon>(`coupon:${coupon.code}`);
        if (existing) {
            return NextResponse.json({ error: 'Coupon code already exists' }, { status: 409 });
        }

        await redis.set(`coupon:${coupon.id}`, coupon);
        await redis.set(`coupon:${coupon.code}`, coupon);
        void mirrorCoupon(coupon);
        return NextResponse.json({ coupon }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 });
    }
}
