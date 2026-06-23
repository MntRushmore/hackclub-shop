import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin } from '../../../../../lib/adminAuth';
import { exchangeCodeForTokens } from '../../../../../lib/hcb';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Complete the HCB OAuth connect: validate the CSRF `state` minted by
 * /api/admin/hcb/connect, then exchange the authorization `code` for tokens
 * (the refresh token is persisted server-side by lib/hcb). Admin-only.
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { code, state } = (await request.json().catch(() => ({}))) as { code?: string; state?: string };
    if (!code || !state) {
        return NextResponse.json({ error: 'Missing code or state.' }, { status: 400 });
    }

    // Validate + consume the one-time state. It must belong to this admin.
    let stateUser: string | null;
    try {
        stateUser = await redis.get<string>(`hcb:oauth:state:${state}`);
    } catch {
        return NextResponse.json({ error: 'Could not verify the request. Try connecting again.' }, { status: 500 });
    }
    if (!stateUser || stateUser !== session!.user!.id) {
        return NextResponse.json({ error: 'Invalid or expired connection request. Try again.' }, { status: 400 });
    }
    void redis.del(`hcb:oauth:state:${state}`);

    const ok = await exchangeCodeForTokens(code);
    if (!ok) {
        return NextResponse.json({ error: 'Failed to connect HCB. Check the app credentials and try again.' }, { status: 502 });
    }
    return NextResponse.json({ connected: true });
}
