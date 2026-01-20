import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CODE_PREFIX = 'HC-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const generateCode = () => {
    let code = CODE_PREFIX;
    for (let i = 0; i < CODE_LENGTH; i++) {
        const randomIndex = Math.floor(Math.random() * CODE_CHARS.length);
        code += CODE_CHARS[randomIndex];
    }
    return code;
};

const normalizeCode = (code: string) => code.trim().toUpperCase();

async function createUniqueCodeForUser(userId: string) {
    for (let i = 0; i < 20; i++) {
        const candidate = generateCode();
        const existingOwner = await redis.get<string>(`claim_code:${candidate}:user`);
        if (!existingOwner || existingOwner === userId) {
            return candidate;
        }
    }
    throw new Error('Unable to generate unique claim code');
}

async function persistCode(userId: string, code: string) {
    await redis.set(`user:${userId}:claim_code_current`, code);
    await redis.sadd(`user:${userId}:claim_codes`, code);
    await redis.set(`claim_code:${code}:user`, userId);
}

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ code: 401, error: 'You must be signed in' }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    try {
        if (!refresh) {
            const existing = await redis.get<string>(`user:${userId}:claim_code_current`);
            if (existing) {
                return NextResponse.json({
                    code: 200,
                    result: { code: normalizeCode(existing), reused: true },
                });
            }
        }

        const newCode = await createUniqueCodeForUser(userId);
        const normalized = normalizeCode(newCode);
        await persistCode(userId, normalized);

        return NextResponse.json({
            code: 200,
            result: { code: normalized, reused: false },
        });
    } catch (error) {
        console.error('[Claim Code] Error creating claim code', error);
        return NextResponse.json({ code: 500, error: 'Failed to create claim code' }, { status: 500 });
    }
}
