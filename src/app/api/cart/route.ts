import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../lib/authOptions';

/**
 * Per-student server-side cart, so a logged-in hack clubber's cart follows them
 * across devices. Guests are not persisted here — their cart stays in
 * localStorage only (no account to key on). The client treats this as a sync
 * target, not the source of truth, and still clears the cart on confirmed
 * checkout success exactly as before.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const key = (userId: string) => `user:${userId}:cart`;

export async function GET() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ cart: null });
    const cart = (await redis.get(key(userId))) ?? null;
    return NextResponse.json({ cart });
}

export async function PUT(request: Request) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { cart?: unknown };
    const cart = Array.isArray(body.cart) ? body.cart.slice(0, 100) : [];
    await redis.set(key(userId), cart);
    return NextResponse.json({ ok: true });
}
