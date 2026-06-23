import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { randomBytes } from 'crypto';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin } from '../../../../../lib/adminAuth';
import { isHcbConfigured, buildAuthorizeUrl } from '../../../../../lib/hcb';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Start the one-time HCB OAuth connect. Admin-only. Generates a CSRF `state`,
 * stashes it in Redis (short TTL), and redirects the admin to HCB's authorize
 * page. HCB returns them to /hcb/callback?code=…&state=…, which posts the code
 * to /api/admin/hcb/callback to complete the exchange.
 *
 * Required because the HCB app can't do machine-to-machine auth — a human admin
 * who can see the org must authorize the app to read its transactions.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (!isHcbConfigured()) {
        return NextResponse.json({ error: 'HCB is not configured.' }, { status: 503 });
    }

    const state = randomBytes(24).toString('hex');
    try {
        // 10-minute window to complete the round-trip.
        await redis.set(`hcb:oauth:state:${state}`, session!.user!.id, { ex: 600 });
    } catch {
        return NextResponse.json({ error: 'Could not start the connection. Try again.' }, { status: 500 });
    }

    return NextResponse.redirect(buildAuthorizeUrl(state));
}
