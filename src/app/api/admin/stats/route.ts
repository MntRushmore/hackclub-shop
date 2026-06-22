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

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || 'all';

        const orderKeys = await redis.keys('user:*:orders');
        let orders: Order[] = [];
        let totalRevenue = 0;
        let totalOrders = 0;
        const ordersByStatus: Record<string, number> = {};

        // Student orders are arrays under user:*:orders.
        for (const key of orderKeys) {
            const userOrders = await redis.get<Order[]>(key);
            if (userOrders) {
                orders = orders.concat(userOrders);
            }
        }

        // Guest (Stripe) orders are stored standalone under order:*.
        const guestKeys = await redis.keys('order:*');
        for (const key of guestKeys) {
            const guestOrder = await redis.get<Order>(key);
            if (guestOrder) orders.push(guestOrder);
        }

        // Newest first across both sources.
        orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const now = new Date();
        let filteredOrders = orders;

        if (period !== 'all') {
            const startDate = new Date();
            switch (period) {
                case 'week':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(now.getMonth() - 1);
                    break;
                case 'year':
                    startDate.setFullYear(now.getFullYear() - 1);
                    break;
            }
            filteredOrders = orders.filter(o => new Date(o.createdAt) >= startDate);
        }

        totalOrders = filteredOrders.length;
        totalRevenue = filteredOrders.reduce((sum, o) => sum + o.totalAmount, 0);

        filteredOrders.forEach(order => {
            ordersByStatus[order.status] = (ordersByStatus[order.status] || 0) + 1;
        });

        const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
        filteredOrders.forEach(order => {
            order.items.forEach(item => {
                const productName = item.name;
                if (!productSales[productName]) {
                    productSales[productName] = { name: productName, quantity: 0, revenue: 0 };
                }
                productSales[productName].quantity += item.quantity;
                productSales[productName].revenue += parseFloat(item.price) * item.quantity;
            });
        });

        const topProducts = Object.entries(productSales)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .slice(0, 10)
            .map(([name, data]) => ({ id: name, ...data }));

        return NextResponse.json({
            period,
            totalOrders,
            totalRevenue: totalRevenue.toFixed(2),
            ordersByStatus,
            topProducts,
            orders: filteredOrders,
        });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
