import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../lib/authOptions';

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
    const identityId = (session.user as any)?.identityId;

    if (!identityId || identityId === newUserId) {
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

        const hasOldBalance = oldBalance !== null && oldBalance !== undefined;
        if (!hasOldBalance && !oldTransactions && !oldOrders) {
            return NextResponse.json({ migrated: false, message: 'No old data found' });
        }

        const promises = [];

        // Never overwrite a balance the destination account already accumulated —
        // only import the legacy balance into a fresh (zero/empty) account. This
        // makes the migration a safe one-shot import, not a clobber/replay
        // primitive even if the :migrated guard were ever cleared.
        if (hasOldBalance) {
            const existingBalance = await redis.get<number>(`user:${newUserId}:pointsBalance`);
            const existingLegacyBalance = await redis.get<number>(`user:${newUserId}:balance`);
            const destinationEmpty =
                (existingBalance === null || existingBalance === undefined || existingBalance === 0) &&
                (existingLegacyBalance === null || existingLegacyBalance === undefined || existingLegacyBalance === 0);
            if (destinationEmpty) {
                promises.push(redis.set(`user:${newUserId}:balance`, oldBalance));
            }
        }
        if (oldTransactions) {
            promises.push(redis.set(`user:${newUserId}:transactions`, oldTransactions));
        }
        if (oldOrders) {
            promises.push(redis.set(`user:${newUserId}:orders`, oldOrders));
        }

        promises.push(redis.set(`user:${newUserId}:migrated`, true));

        await Promise.all(promises);

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
