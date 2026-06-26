import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
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
        const orders: (Order & { userId: string })[] = [];

        // Student / points orders live in per-user arrays (`user:{id}:orders`).
        const studentKeys = await redis.keys('user:*:orders');
        for (const key of studentKeys) {
            const userId = key.split(':')[1];
            const userOrders = await redis.get<Order[]>(key);
            if (userOrders) {
                for (const o of userOrders) {
                    orders.push({ ...o, userId });
                }
            }
        }

        // Guest / Stripe orders live as single `order:{id}` keys (created unpaid,
        // finalized by the Stripe webhook). These were previously NOT surfaced in
        // the admin list, so paid guest orders looked like they "never came in".
        const guestKeys = await redis.keys('order:*');
        for (const key of guestKeys) {
            const o = await redis.get<Order>(key);
            if (o && o.id) orders.push({ ...o, userId: o.userId || '' });
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
