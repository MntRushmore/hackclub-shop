import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Product, Coupon } from '../../../../types/Admin';
import { Order } from '../../../../types/Order';
import {
    mirrorProduct,
    mirrorOrder,
    mirrorUser,
    mirrorCoupon,
} from '../../../../lib/airtableMirror';
import { setStock } from '../../../../lib/inventory';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * One-time (re-runnable, idempotent) backfill of existing Redis data into
 * Airtable. Admin-only. POST to run. Mirrors are upsert-by-id so re-running is
 * safe. Calls are awaited sequentially with a small delay to respect Airtable's
 * ~5 req/sec limit.
 */
export async function POST() {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
        return NextResponse.json(
            { error: 'Airtable is not configured (missing AIRTABLE_API_KEY / AIRTABLE_BASE_ID).' },
            { status: 500 },
        );
    }

    // ~4 req/sec throttle to stay under Airtable's 5/sec limit.
    const throttle = () => new Promise((r) => setTimeout(r, 250));

    const counts = { products: 0, coupons: 0, users: 0, orders: 0, variantsStocked: 0, errors: 0 };

    try {
        // Products — also seed the inventory cache from each variant's stock so
        // tracking works immediately without waiting for the first Airtable sync.
        const productKeys = await redis.keys('product:*');
        for (const key of productKeys) {
            const product = await redis.get<Product>(key);
            if (product?.id) {
                await mirrorProduct(product);
                counts.products++;
                for (const v of product.variants || []) {
                    const variantId = String(v.variant_id || v.id);
                    if (!variantId) continue;
                    const stock = typeof v.stock === 'number' ? v.stock : null;
                    await setStock(variantId, stock);
                    if (stock !== null) counts.variantsStocked++;
                }
                await throttle();
            }
        }

        // Coupons — coupon:{id} and coupon:{code} both exist; dedupe by id.
        const couponKeys = await redis.keys('coupon:*');
        const seenCoupons = new Set<string>();
        for (const key of couponKeys) {
            const coupon = await redis.get<Coupon>(key);
            if (coupon?.id && !seenCoupons.has(coupon.id)) {
                seenCoupons.add(coupon.id);
                await mirrorCoupon(coupon);
                counts.coupons++;
                await throttle();
            }
        }

        // Users — distinct ids from balance/points/orders keys.
        const userIds = new Set<string>();
        for (const pattern of ['user:*:balance', 'user:*:pointsBalance', 'user:*:orders']) {
            const keys = await redis.keys(pattern);
            for (const k of keys) userIds.add(k.split(':')[1]);
        }
        for (const userId of userIds) {
            const [balance, pointsBalance, slackId] = await Promise.all([
                redis.get<number>(`user:${userId}:balance`),
                redis.get<number>(`user:${userId}:pointsBalance`),
                redis.get<string>(`user:${userId}:slackId`),
            ]);
            await mirrorUser({
                userId,
                balance: balance ?? 0,
                pointsBalance: pointsBalance ?? 0,
                slackId: slackId ?? undefined,
            });
            counts.users++;
            await throttle();

            // Orders for this user
            const orders = await redis.get<Order[]>(`user:${userId}:orders`);
            if (Array.isArray(orders)) {
                for (const order of orders) {
                    await mirrorOrder({ ...order, userId }, slackId ?? undefined);
                    counts.orders++;
                    await throttle();
                }
            }
        }

        return NextResponse.json({ ok: true, counts });
    } catch (error) {
        console.error('[Airtable Backfill] Error:', error);
        counts.errors++;
        return NextResponse.json(
            { error: 'Backfill failed partway', counts, detail: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
