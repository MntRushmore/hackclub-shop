import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { mirrorUser } from '../../../../../../lib/airtableMirror';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageBalance');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { amount, reason } = body;

        if (typeof amount !== 'number' || !reason) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const userId = params.id;
        const currentBalance = (await redis.get<number>(`user:${userId}:balance`)) || 0;
        const newBalance = Math.max(0, currentBalance + amount);

        await redis.set(`user:${userId}:balance`, newBalance);
        void mirrorUser({ userId, balance: newBalance });

        const transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount,
            type: amount > 0 ? 'deposit' : 'purchase',
            description: `Admin adjustment: ${reason}`,
            timestamp: new Date(),
        };

        const transactions = (await redis.get<any[]>(`user:${userId}:transactions`)) || [];
        transactions.push(transaction);
        await redis.set(`user:${userId}:transactions`, transactions);

        return NextResponse.json({
            userId,
            previousBalance: currentBalance,
            newBalance,
            transaction,
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to adjust balance' }, { status: 500 });
    }
}
