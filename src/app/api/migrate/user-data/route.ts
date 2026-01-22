import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function POST() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const newUserId = session.user.id;
    const slackId = (session.user as any)?.slackId;
    const identityId = (session.user as any)?.identityId;

    console.log('[Migration] User IDs:', { newUserId, slackId, identityId });

    if (!identityId || identityId === newUserId) {
        console.log('[Migration] No migration needed - identityId === newUserId or missing identityId');
        return NextResponse.json({ migrated: false, message: 'No migration needed' });
    }

    try {
        const alreadyMigrated = await redis.get<boolean>(`user:${newUserId}:migrated`);
        if (alreadyMigrated) {
            return NextResponse.json({ migrated: false, message: 'Already migrated' });
        }

        const oldBalance = await redis.get<number>(`user:${identityId}:balance`);
        const oldTransactions = await redis.get<any[]>(`user:${identityId}:transactions`);
        const oldOrders = await redis.get<any[]>(`user:${identityId}:orders`);

        console.log('[Migration] Found old data:', { 
            hasBalance: oldBalance !== null && oldBalance !== undefined,
            transactionCount: oldTransactions?.length || 0,
            orderCount: oldOrders?.length || 0,
        });

        if (oldBalance === null && oldBalance === undefined && !oldTransactions && !oldOrders) {
            console.log('[Migration] No old data found at user:', identityId);
            return NextResponse.json({ migrated: false, message: 'No old data found' });
        }

        const promises = [];
        
        if (oldBalance !== null && oldBalance !== undefined) {
            console.log('[Migration] Migrating balance:', oldBalance);
            promises.push(redis.set(`user:${newUserId}:balance`, oldBalance));
        }
        if (oldTransactions) {
            console.log('[Migration] Migrating transactions count:', oldTransactions.length);
            promises.push(redis.set(`user:${newUserId}:transactions`, oldTransactions));
        }
        if (oldOrders) {
            console.log('[Migration] Migrating orders count:', oldOrders.length);
            promises.push(redis.set(`user:${newUserId}:orders`, oldOrders));
        }

        promises.push(redis.set(`user:${newUserId}:migrated`, true));

        await Promise.all(promises);

        console.log('[Migration] Migration completed successfully');
        return NextResponse.json({
            migrated: true,
            message: 'User data migrated successfully',
            stats: {
                balance: oldBalance || 0,
                transactionCount: oldTransactions?.length || 0,
                orderCount: oldOrders?.length || 0,
            },
        });
    } catch (error) {
        console.error('[Migration API] Error migrating user data:', error);
        return NextResponse.json({ error: 'Failed to migrate user data' }, { status: 500 });
    }
}
