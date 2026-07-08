import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { mirrorUser } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const balanceKey = (userId: string) => `user:${userId}:pointsBalance`;
const txKey = (userId: string) => `user:${userId}:pointsTransactions`;

// Atomic adjust-with-floor: read, add, clamp at 0, write — one script, so two
// concurrent adjustments can't read the same base and clobber each other.
// Returns {previous, new, applied} (applied differs from the request when the
// floor clips a deduction; the audit trail records the real delta).
const ADJUST_LUA = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local prev = tonumber(redis.call('GET', key) or '0')
local new = prev + delta
if new < 0 then new = 0 end
redis.call('SET', key, new)
return {prev, new, new - prev}
`;

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
        const [currentBalance, newBalance, applied] = await redis.eval(
            ADJUST_LUA,
            [balanceKey(userId)],
            [amount],
        ) as [number, number, number];
        void mirrorUser({ userId, pointsBalance: newBalance });

        const transaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            // The applied delta, not the requested one — when the zero floor
            // clips a deduction, the ledger must match what actually happened.
            amount: applied,
            type: applied >= 0 ? 'earn' : 'adjust',
            description: `Admin adjustment: ${reason}${applied !== amount ? ` (requested ${amount}, clipped at zero balance)` : ''}`,
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
            summary: `${amount >= 0 ? 'Granted' : 'Deducted'} ${Math.abs(applied)} pts ${amount >= 0 ? 'to' : 'from'} ${userId} (→ ${newBalance}). Reason: ${reason}`,
            metadata: { amount, applied, previousBalance: currentBalance, newBalance, reason },
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
