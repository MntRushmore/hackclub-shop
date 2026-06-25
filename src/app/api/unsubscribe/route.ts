import { NextRequest, NextResponse } from 'next/server';
import { suppressMarketing, resubscribeMarketing, verifyUnsubscribeToken } from '../../../lib/emailSuppression';

/**
 * Unsubscribe endpoint.
 *
 * Two callers:
 *  1. Mail clients (Gmail/Apple) firing RFC 8058 one-click: POST with
 *     `List-Unsubscribe=One-Click` as form data. We honor the signed token in the
 *     query string and suppress immediately, returning 200 with no body.
 *  2. Our own unsubscribe page, sending JSON { email, token, action }.
 *
 * The token is an HMAC of the email (see emailSuppression.ts) — no auth needed,
 * but it can't be forged or used to enumerate addresses.
 */
export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const contentType = req.headers.get('content-type') || '';

    // Resolve email/token/action from either the one-click form post or our JSON.
    let email = url.searchParams.get('email') || '';
    let token = url.searchParams.get('token') || '';
    let action: 'unsubscribe' | 'resubscribe' = 'unsubscribe';

    if (contentType.includes('application/json')) {
        const body = await req.json().catch(() => ({}));
        email = (body.email as string) || email;
        token = (body.token as string) || token;
        if (body.action === 'resubscribe') action = 'resubscribe';
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // One-click clients send `List-Unsubscribe=One-Click` in the body; the
        // identifying email + token ride along in the query string of the URL we
        // put in the List-Unsubscribe header.
        await req.formData().catch(() => null);
    }

    if (!verifyUnsubscribeToken(email, token)) {
        return NextResponse.json({ error: 'Invalid or expired unsubscribe link.' }, { status: 400 });
    }

    const ok = action === 'resubscribe'
        ? await resubscribeMarketing(email, token)
        : await suppressMarketing(email, token);

    if (!ok) return NextResponse.json({ error: 'Could not update your preferences.' }, { status: 400 });
    return NextResponse.json({ ok: true, action });
}
