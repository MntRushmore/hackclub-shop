import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
import { PointsTransaction } from '../../../../types/Points';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const balanceKey = (userId: string) => `user:${userId}:pointsBalance`;
const txKey = (userId: string) => `user:${userId}:pointsTransactions`;

// READ-ONLY endpoint. Points are money-equivalent (1 point = $1), so a balance
// may ONLY be changed by trusted server-side flows:
//   - earning: admin grant (/api/admin/users/[id]/points) or project approval
//     (/api/admin/projects/[id]/approve), both behind canManageBalance.
//   - spending: order creation (/api/orders), which recomputes the cost
//     server-side from authoritative product data and deducts atomically.
// There is deliberately no client-writable POST/PUT here — a self-service
// credit/debit endpoint would let any logged-in user mint or move balance.

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
