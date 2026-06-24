import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Order } from '../../../../types/Order';
import { Product } from '../../../../types/Admin';
import { getVariantStocks } from '../../../../lib/inventory';

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

        // Aggregates (revenue, counts, top products) exclude test orders so junk
        // doesn't pollute the numbers. The full list — including test orders — is
        // still returned for the admin page to optionally show.
        const realOrders = filteredOrders.filter(o => !o.isTest);

        // Revenue is what we earned, not what we collected — sales tax (Stripe Tax,
        // folded into totalAmount on payment) is a pass-through liability, so back
        // it out. Old/points/HCB orders have no taxAmount and net to totalAmount.
        const netRevenue = (o: typeof realOrders[number]) => o.totalAmount - (o.taxAmount || 0);

        totalOrders = realOrders.length;
        totalRevenue = realOrders.reduce((sum, o) => sum + netRevenue(o), 0);

        realOrders.forEach(order => {
            ordersByStatus[order.status] = (ordersByStatus[order.status] || 0) + 1;
        });

        const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
        realOrders.forEach(order => {
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

        // Points vs cash split (real orders): cash revenue (USD) vs points spent.
        const cashRevenue = realOrders.filter(o => o.pathway === 'guest').reduce((s, o) => s + netRevenue(o), 0);
        const pointsSpent = realOrders.filter(o => o.pathway === 'student').reduce((s, o) => s + (o.pointsSpent || 0), 0);
        const guestOrderCount = realOrders.filter(o => o.pathway === 'guest').length;
        const studentOrderCount = realOrders.filter(o => o.pathway === 'student').length;

        // Revenue + order count over time, bucketed by day across the period.
        const dayBuckets: Record<string, { revenue: number; orders: number }> = {};
        for (const o of realOrders) {
            const day = new Date(o.createdAt).toISOString().slice(0, 10);
            if (!dayBuckets[day]) dayBuckets[day] = { revenue: 0, orders: 0 };
            dayBuckets[day].revenue += netRevenue(o);
            dayBuckets[day].orders += 1;
        }
        const timeSeries = Object.entries(dayBuckets)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, v]) => ({ date, revenue: Number(v.revenue.toFixed(2)), orders: v.orders }));

        // Abandoned/expired guest sessions (orders denied while still unpaid),
        // scoped to the selected period like the other aggregates.
        const abandonedSessions = filteredOrders.filter(o => o.pathway === 'guest' && o.paymentStatus === 'unpaid' && o.status === 'denied').length;

        // Low-stock count across tracked variants (available ≤ 5).
        let lowStockCount = 0;
        try {
            const productKeys = await redis.keys('product:*');
            const variantIds: string[] = [];
            for (const key of productKeys) {
                const p = await redis.get<Product>(key);
                for (const v of p?.variants || []) variantIds.push(String(v.variant_id || v.id));
            }
            const stocks = await getVariantStocks(variantIds);
            lowStockCount = Object.values(stocks).filter(s => s.available !== null && s.available <= 5).length;
        } catch {
            // Best-effort; leave at 0 if inventory read fails.
        }

        return NextResponse.json({
            period,
            totalOrders,
            totalRevenue: totalRevenue.toFixed(2),
            ordersByStatus,
            topProducts,
            cashRevenue: cashRevenue.toFixed(2),
            pointsSpent,
            guestOrderCount,
            studentOrderCount,
            timeSeries,
            abandonedSessions,
            lowStockCount,
            orders: filteredOrders,
        });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
