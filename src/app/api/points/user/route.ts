import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PointsTransaction } from '../../../../types/Points';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const balanceKey = (userId: string) => `user:${userId}:pointsBalance`;
const txKey = (userId: string) => `user:${userId}:pointsTransactions`;

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const rateLimitResult = await rateLimit(`points:get:${userId}`, { maxRequests: 30, windowMs: 60000 });
    if (!rateLimitResult.success) return rateLimitResponse();

    try {
        const balance = await redis.get<number>(balanceKey(userId)) || 0;
        const transactions = await redis.get<PointsTransaction[]>(txKey(userId)) || [];
        return NextResponse.json({ balance, transactions });
    } catch (error) {
        console.error('[Points API] Error fetching points:', error);
        return NextResponse.json({ error: 'Failed to fetch points' }, { status: 500 });
    }
}

// Earn points
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const rateLimitResult = await rateLimit(`points:post:${userId}`, { maxRequests: 10, windowMs: 60000 });
    if (!rateLimitResult.success) return rateLimitResponse();

    try {
        const { amount, description, transactionType = 'earn' } = await request.json();
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        const currentBalance = await redis.get<number>(balanceKey(userId)) || 0;
        const currentTransactions = await redis.get<PointsTransaction[]>(txKey(userId)) || [];

        const transaction: PointsTransaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount,
            type: transactionType as PointsTransaction['type'],
            description: description || 'Points earned',
            timestamp: new Date(),
        };

        const newBalance = currentBalance + amount;
        await redis.set(balanceKey(userId), newBalance);
        await redis.set(txKey(userId), [transaction, ...currentTransactions]);

        return NextResponse.json({ balance: newBalance, transaction });
    } catch (error) {
        console.error('[Points API] Error adding points:', error);
        return NextResponse.json({ error: 'Failed to add points' }, { status: 500 });
    }
}

// Spend points
export async function PUT(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const rateLimitResult = await rateLimit(`points:put:${userId}`, { maxRequests: 10, windowMs: 60000 });
    if (!rateLimitResult.success) return rateLimitResponse();

    try {
        const { amount, orderId } = await request.json();
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        const currentBalance = await redis.get<number>(balanceKey(userId)) || 0;
        if (currentBalance < amount) {
            return NextResponse.json({ error: 'Insufficient points' }, { status: 400 });
        }

        const currentTransactions = await redis.get<PointsTransaction[]>(txKey(userId)) || [];
        const transaction: PointsTransaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -amount,
            type: 'spend',
            description: 'Spent points in shop',
            timestamp: new Date(),
            orderId,
        };

        const newBalance = currentBalance - amount;
        await redis.set(balanceKey(userId), newBalance);
        await redis.set(txKey(userId), [transaction, ...currentTransactions]);

        return NextResponse.json({ balance: newBalance, transaction });
    } catch (error) {
        console.error('[Points API] Error spending points:', error);
        return NextResponse.json({ error: 'Failed to spend points' }, { status: 500 });
    }
}
