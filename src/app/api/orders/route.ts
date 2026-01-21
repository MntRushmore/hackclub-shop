import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../auth/[...nextauth]/route';
import { Order, OrderItem } from '../../../types/Order';
import { rateLimit, rateLimitResponse } from '../../../lib/rateLimit';
import { CreditTransaction } from '../../../types/Credits';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// GET - Fetch user's orders
export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 30 requests per minute
    const rateLimitResult = await rateLimit(`orders:get:${userId}`, { maxRequests: 30, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const orders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        return NextResponse.json({ orders });
    } catch (error) {
        console.error('[Orders API] Error fetching orders:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

// POST - Create a new order (requires full payment via credits)
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 5 orders per minute
    const rateLimitResult = await rateLimit(`orders:post:${userId}`, { maxRequests: 5, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const { items, totalAmount } = await request.json() as { items: OrderItem[]; totalAmount: number };

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'No items in order' }, { status: 400 });
        }

        if (typeof totalAmount !== 'number' || totalAmount <= 0) {
            return NextResponse.json({ error: 'Invalid total amount' }, { status: 400 });
        }

        // Check user has enough credits
        const currentBalance = await redis.get<number>(`user:${userId}:balance`) || 0;

        if (currentBalance < totalAmount) {
            return NextResponse.json({ 
                error: 'Insufficient credits', 
                required: totalAmount,
                balance: currentBalance 
            }, { status: 400 });
        }

        // Create order
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const order: Order = {
            id: orderId,
            userId,
            items,
            totalAmount,
            creditsPaid: totalAmount,
            status: 'completed',
            createdAt: new Date(),
        };

        // Deduct credits
        const newBalance = currentBalance - totalAmount;
        const currentTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];
        
        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -totalAmount,
            type: 'purchase',
            description: `Order #${orderId.slice(-8)}`,
            timestamp: new Date(),
            orderId,
        };

        const newTransactions = [transaction, ...currentTransactions];

        // Save everything atomically
        const currentOrders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        const newOrders = [order, ...currentOrders];

        await Promise.all([
            redis.set(`user:${userId}:balance`, newBalance),
            redis.set(`user:${userId}:transactions`, newTransactions),
            redis.set(`user:${userId}:orders`, newOrders),
        ]);

        return NextResponse.json({ 
            order,
            newBalance,
            transaction,
        });
    } catch (error) {
        console.error('[Orders API] Error creating order:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
