import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}

export async function rateLimit(
    identifier: string,
    config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 }
): Promise<{ success: boolean; remaining: number; reset: number }> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count current requests
    const requestCount = await redis.zcard(key);

    if (requestCount >= config.maxRequests) {
        const oldestEntry = await redis.zrange<string[]>(key, 0, 0, { withScores: true });
        const resetTime = oldestEntry.length >= 2 ? Number(oldestEntry[1]) + config.windowMs : now + config.windowMs;
        return { success: false, remaining: 0, reset: resetTime };
    }

    // Add new request
    await redis.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    await redis.expire(key, Math.ceil(config.windowMs / 1000));

    return { success: true, remaining: config.maxRequests - requestCount - 1, reset: now + config.windowMs };
}

export function rateLimitResponse() {
    return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
    );
}
