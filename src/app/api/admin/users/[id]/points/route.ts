import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { mirrorUser } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const balanceKey = (userId: string) => `user:${userId}:pointsBalance`;
const txKey = (userId: string) => `user:${userId}:pointsTransactions`;

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
        const currentBalance = (await redis.get<number>(balanceKey(userId))) || 0;
        const newBalance = Math.max(0, currentBalance + amount);

        await redis.set(balanceKey(userId), newBalance);
        void mirrorUser({ userId, pointsBalance: newBalance });

        const transaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount,
            type: amount > 0 ? 'earn' : 'spend',
            description: `Admin adjustment: ${reason}`,
            timestamp: new Date(),
        };

        const transactions = (await redis.get<any[]>(txKey(userId))) || [];
        transactions.unshift(transaction);
        await redis.set(txKey(userId), transactions);

        void recordAudit({
            action: amount >= 0 ? 'points.grant' : 'points.deduct',
            actorId: session?.user?.id || 'unknown',
            actorEmail: session?.user?.email || undefined,
            target: userId,
            summary: `${amount >= 0 ? 'Granted' : 'Deducted'} ${Math.abs(amount)} pts ${amount >= 0 ? 'to' : 'from'} ${userId} (→ ${newBalance}). Reason: ${reason}`,
            metadata: { amount, previousBalance: currentBalance, newBalance, reason },
        });

        return NextResponse.json({
            userId,
            previousBalance: currentBalance,
            newBalance,
            transaction,
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to adjust points' }, { status: 500 });
    }
}
