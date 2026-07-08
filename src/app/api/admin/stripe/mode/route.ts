import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin, requireAdminPermission } from '../../../../../lib/adminAuth';
import { recordAudit } from '../../../../../lib/auditLog';
import {
    isStripeConfigured,
    getGlobalStripeMode,
    setGlobalStripeMode,
    getAdminStripeMode,
    setAdminStripeMode,
    type StripeMode,
} from '../../../../../lib/stripe';

/**
 * Admin control of the Stripe checkout mode.
 *
 * GET: the current global mode, the caller's personal override, and whether
 * the test key slot is configured (so the UI can disable the toggle).
 *
 * POST { scope: 'global' | 'personal', mode: 'live' | 'test' | null }:
 *  - global: flips checkout for EVERYONE (guests included). Finance-gated
 *    (canManageFinance) and audit-logged, since it decides whether real cards
 *    are charged. `mode` must be 'live' or 'test'.
 *  - personal: sets the calling admin's own override; null clears it (follow
 *    global). Any admin role may set their own — it only affects checkouts
 *    they start while signed in.
 *
 * Switching anything to 'test' requires STRIPE_SECRET_KEY_TEST to be set;
 * without it the request is rejected so checkout can't be pointed at a key
 * that doesn't exist.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const userId = session!.user!.id!;
    const [global, personal] = await Promise.all([
        getGlobalStripeMode(),
        getAdminStripeMode(userId),
    ]);
    return NextResponse.json({
        global,
        personal, // null = follows global
        effective: personal || global,
        testConfigured: isStripeConfigured('test'),
        liveConfigured: isStripeConfigured('live'),
    });
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const userId = session!.user!.id!;

    let body: { scope?: string; mode?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { scope, mode } = body;
    if (scope !== 'global' && scope !== 'personal') {
        return NextResponse.json({ error: "scope must be 'global' or 'personal'" }, { status: 400 });
    }
    if (mode !== 'live' && mode !== 'test' && !(scope === 'personal' && mode === null)) {
        return NextResponse.json(
            { error: scope === 'personal' ? "mode must be 'live', 'test', or null" : "mode must be 'live' or 'test'" },
            { status: 400 },
        );
    }
    if (mode === 'test' && !isStripeConfigured('test')) {
        return NextResponse.json(
            { error: 'STRIPE_SECRET_KEY_TEST is not set, so test mode is unavailable.' },
            { status: 400 },
        );
    }

    if (scope === 'global') {
        // Global flips decide whether real customers' cards are charged —
        // finance-gated and audited.
        const perm = await requireAdminPermission(session, 'canManageFinance');
        if (!perm.allowed) {
            return NextResponse.json({ error: 'Requires finance permission' }, { status: 403 });
        }
        if (mode === 'live' && !isStripeConfigured('live')) {
            return NextResponse.json({ error: 'STRIPE_SECRET_KEY is not set.' }, { status: 400 });
        }
        const previous = await getGlobalStripeMode();
        await setGlobalStripeMode(mode as StripeMode);
        if (previous !== mode) {
            void recordAudit({
                action: 'stripe.mode',
                actorId: userId,
                actorEmail: session!.user!.email || undefined,
                summary: `Switched Stripe checkout to ${mode} mode for everyone (was ${previous})`,
                metadata: { scope: 'global', from: previous, to: mode },
            });
        }
    } else {
        await setAdminStripeMode(userId, mode as StripeMode | null);
    }

    const [global, personal] = await Promise.all([
        getGlobalStripeMode(),
        getAdminStripeMode(userId),
    ]);
    return NextResponse.json({
        global,
        personal,
        effective: personal || global,
        testConfigured: isStripeConfigured('test'),
        liveConfigured: isStripeConfigured('live'),
    });
}
