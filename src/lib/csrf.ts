import { Redis } from '@upstash/redis';
import { getServerSession } from 'next-auth';
import { authOptions } from './authOptions';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function generateCSRFToken(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;

    const token = crypto.randomUUID();
    const key = `csrf:${session.user.id}`;
    
    // Store token with 1 hour TTL
    await redis.set(key, token, { ex: 3600 });
    
    return token;
}

export async function validateCSRFToken(token: string): Promise<boolean> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return false;

    const key = `csrf:${session.user.id}`;
    const storedToken = await redis.get<string>(key);
    
    if (!storedToken || storedToken !== token) {
        return false;
    }
    
    // Rotate token after use
    const newToken = crypto.randomUUID();
    await redis.set(key, newToken, { ex: 3600 });
    
    return true;
}
