import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission, getAdminRole } from '../../../../lib/adminAuth';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface AdminUserRow {
    userId: string;
    name: string | null;
    email: string | null;
    pointsBalance: number;
    slackId: string | null;
    role: string | null;
    orderCount: number;
}

// GET - list every known user with points/role (admin view).
// Users are implied by the existence of user:{id}:* keys.
export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // Collect distinct user ids from points and order keys.
        const keyPatterns = ['user:*:pointsBalance', 'user:*:orders'];
        const userIds = new Set<string>();
        for (const pattern of keyPatterns) {
            const keys = await redis.keys(pattern);
            for (const key of keys) {
                userIds.add(key.split(':')[1]);
            }
        }

        const users: AdminUserRow[] = [];
        for (const userId of userIds) {
            const [pointsBalance, name, email, slackId, orders, role] = await Promise.all([
                redis.get<number>(`user:${userId}:pointsBalance`),
                redis.get<string>(`user:${userId}:name`),
                redis.get<string>(`user:${userId}:email`),
                redis.get<string>(`user:${userId}:slackId`),
                redis.get<unknown[]>(`user:${userId}:orders`),
                getAdminRole(userId),
            ]);

            users.push({
                userId,
                name: name ?? null,
                email: email ?? null,
                pointsBalance: pointsBalance ?? 0,
                slackId: slackId ?? null,
                role: role ?? null,
                orderCount: Array.isArray(orders) ? orders.length : 0,
            });
        }

        users.sort((a, b) => b.pointsBalance - a.pointsBalance);

        return NextResponse.json({ users });
    } catch (error) {
        console.error('[Admin Users] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
}
