import { NextResponse } from 'next/server';
import {
    isLaunchLockEnabled,
    verifyPassword,
    expectedCookieValue,
    COOKIE_NAME,
    COOKIE_MAX_AGE,
} from '../../../../lib/launchLock';

/**
 * Launch-lock unlock endpoint.
 *
 * POST { password } → if it matches LAUNCH_PASSWORD, set the httpOnly signed
 * cookie the middleware checks, then the client reloads and the gate lets them
 * through. The password itself is verified server-side and never echoed; the
 * cookie carries only an HMAC of a fixed string, so nothing sensitive lands in
 * the browser.
 *
 * Edge runtime: uses only Web Crypto (via lib/launchLock), same code path the
 * middleware verifies with.
 */
export const runtime = 'edge';

export async function POST(request: Request) {
    if (!isLaunchLockEnabled()) {
        // Nothing to unlock — the site is already open.
        return NextResponse.json({ error: 'Launch lock is not enabled.' }, { status: 400 });
    }

    let body: { password?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyPassword(password))) {
        // Generic message — no hint about length or correctness.
        return NextResponse.json({ error: 'That password is not correct.' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, await expectedCookieValue(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: COOKIE_MAX_AGE,
    });
    return res;
}
