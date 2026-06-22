import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Order } from '../../../../types/Order';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// GET - list every order across all users (admin view).
export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const orderKeys = await redis.keys('user:*:orders');
        const orders: (Order & { userId: string })[] = [];

        for (const key of orderKeys) {
            const userId = key.split(':')[1];
            const userOrders = await redis.get<Order[]>(key);
            if (userOrders) {
                for (const o of userOrders) {
                    orders.push({ ...o, userId });
                }
            }
        }

        orders.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        return NextResponse.json({ orders });
    } catch (error) {
        console.error('[Admin Orders] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}
