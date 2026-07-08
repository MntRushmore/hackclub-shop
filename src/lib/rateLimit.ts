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

/**
 * Sliding-window limiter, atomic in one Lua round trip: trim the window, count,
 * and conditionally add are a single script, so a burst of concurrent requests
 * can't all read a below-limit count and slip past (the old trim → count → add
 * sequence raced). Returns {allowed, remaining, resetMs}.
 */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = now + window
  if oldest[2] then reset = tonumber(oldest[2]) + window end
  return {0, 0, reset}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, max - count - 1, now + window}
`;

export async function rateLimit(
    identifier: string,
    config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 }
): Promise<{ success: boolean; remaining: number; reset: number }> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();

    try {
        const [allowed, remaining, reset] = await redis.eval(
            RATE_LIMIT_LUA,
            [key],
            [now, config.windowMs, config.maxRequests, `${now}-${Math.random()}`],
        ) as [number, number, number];
        return { success: allowed === 1, remaining, reset };
    } catch (err) {
        // Fail open: a Redis hiccup must not take checkout down — the limiter
        // is abuse protection, not a correctness gate (money paths revalidate
        // everything server-side regardless).
        console.error('[rateLimit] eval failed:', err instanceof Error ? err.message : err);
        return { success: true, remaining: 0, reset: now + config.windowMs };
    }
}

export function rateLimitResponse() {
    return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
    );
}
