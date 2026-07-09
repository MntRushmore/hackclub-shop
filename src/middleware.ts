import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isLaunchLockEnabled, isAllowlisted, COOKIE_NAME, isValidCookie } from './lib/launchLock';

/**
 * Site-wide launch lock. Runs on every request (see `config.matcher`) before
 * any page or route handler renders, so the "coming soon" gate cannot be
 * bypassed client-side.
 *
 * Order of checks — first pass-through wins:
 *   1. Lock disabled  → let everything through (normal site).
 *   2. Allowlisted    → auth/webhook/cron/the lock page itself must always work.
 *   3. Global admin   → signed-in GLOBAL_ADMINS skip the wall (no password).
 *   4. Unlock cookie  → a visitor who entered the password already.
 *   5. Otherwise      → REWRITE to /launch (not redirect — no ?callbackUrl
 *                       open-redirect surface, and the URL bar keeps its path).
 *
 * Everything here is Edge-safe: JWT decode via getToken (no DB/Redis), env
 * reads, and Web Crypto through ./lib/launchLock.
 */

function globalAdminIds(): string[] {
    return (process.env.GLOBAL_ADMINS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

async function isGlobalAdmin(req: NextRequest): Promise<boolean> {
    const admins = globalAdminIds();
    if (admins.length === 0) return false;
    try {
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        if (!token) return false;
        // Must mirror authOptions' session callback: the app's user id is
        // slackId when present, else the identity id. Checking only `id` would
        // silently drop the bypass for Slack-identified admins.
        const userId = (token.slackId as string) || (token.id as string) || '';
        return userId !== '' && admins.includes(userId);
    } catch {
        // A malformed/undecodable token is treated as "not an admin" — fail
        // closed, never unlock on a decode error.
        return false;
    }
}

export async function middleware(req: NextRequest) {
    if (!isLaunchLockEnabled()) return NextResponse.next();

    const { pathname } = req.nextUrl;
    if (isAllowlisted(pathname)) return NextResponse.next();

    if (await isGlobalAdmin(req)) return NextResponse.next();

    if (await isValidCookie(req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();

    return NextResponse.rewrite(new URL('/launch', req.url));
}

export const config = {
    // Run on everything EXCEPT Next internals and static assets, so the lock
    // page's own CSS/fonts/images still load while the site is gated. The
    // path-level allowlist (auth/webhooks/cron) is enforced in the handler
    // above, not here — the matcher only strips out things that never need
    // gating.
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|images/|fonts/|gifts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff|woff2|json|txt|xml)$).*)',
    ],
};
