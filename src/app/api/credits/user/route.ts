import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { CreditTransaction } from '../../../../types/Credits';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// GET - Fetch user's credits and transactions
export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 30 requests per minute
    const rateLimitResult = await rateLimit(`credits:get:${userId}`, { maxRequests: 30, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const balance = await redis.get<number>(`user:${userId}:balance`) || 0;
        const transactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];

        return NextResponse.json({
            balance,
            transactions,
        });
    } catch (error) {
        console.error('[Credits API] Error fetching credits:', error);
        return NextResponse.json({ error: 'Failed to fetch credits' }, { status: 500 });
    }
}

// POST - Add credits to user's account (deposits or refunds)
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 10 requests per minute
    const rateLimitResult = await rateLimit(`credits:post:${userId}`, { maxRequests: 10, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const { amount, description, donationId, transactionType = 'deposit' } = await request.json();

        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        // Get current balance and transactions
        const currentBalance = await redis.get<number>(`user:${userId}:balance`) || 0;
        const currentTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];

        // Create new transaction
        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount,
            type: transactionType as 'deposit' | 'refund',
            description: description || (transactionType === 'refund' ? 'Refund' : 'Added credits via HCB'),
            timestamp: new Date(),
        };

        // Update balance and transactions
        const newBalance = currentBalance + amount;
        const newTransactions = [transaction, ...currentTransactions];

        await redis.set(`user:${userId}:balance`, newBalance);
        await redis.set(`user:${userId}:transactions`, newTransactions);

        // If donationId provided, mark it as claimed for this user
        if (donationId) {
            await redis.set(`donation:${donationId}:user`, userId);
        }

        return NextResponse.json({
            balance: newBalance,
            transaction,
        });
    } catch (error) {
        console.error('[Credits API] Error adding credits:', error);
        return NextResponse.json({ error: 'Failed to add credits' }, { status: 500 });
    }
}

// PUT - Use credits (for purchases)
export async function PUT(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 10 requests per minute
    const rateLimitResult = await rateLimit(`credits:put:${userId}`, { maxRequests: 10, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const { amount, orderId } = await request.json();

        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        // Get current balance
        const currentBalance = await redis.get<number>(`user:${userId}:balance`) || 0;

        if (currentBalance < amount) {
            return NextResponse.json({ error: 'Insufficient credits' }, { status: 400 });
        }

        const currentTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];

        // Create purchase transaction
        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -amount,
            type: 'purchase',
            description: 'Purchase at Hack Club Shop',
            timestamp: new Date(),
            orderId,
        };

        // Update balance and transactions
        const newBalance = currentBalance - amount;
        const newTransactions = [transaction, ...currentTransactions];

        await redis.set(`user:${userId}:balance`, newBalance);
        await redis.set(`user:${userId}:transactions`, newTransactions);

        return NextResponse.json({
            balance: newBalance,
            transaction,
        });
    } catch (error) {
        console.error('[Credits API] Error using credits:', error);
        return NextResponse.json({ error: 'Failed to use credits' }, { status: 500 });
    }
}
