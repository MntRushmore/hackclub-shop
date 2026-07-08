import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { isStripeConfigured } from '../../../../../lib/stripe';
import { rebuildCatalogCache } from '../../../../../lib/catalog';

/**
 * Rebuild the storefront's catalog cache projection from Stripe, WITHOUT the
 * Redis→Stripe import that /api/admin/catalog/sync performs.
 *
 * The one time this is essential: go-live. The cache stores each variant's
 * stripePriceId, and price ids are per-account — after production's
 * STRIPE_SECRET_KEY flips from the test account to the live one, the cache
 * still projects TEST price ids, which the live account rejects at checkout.
 * One POST here re-projects everything from the (now live) account. Also handy
 * any time the cache is suspected stale (missed catalog webhook, manual
 * dashboard surgery).
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const perm = await requireAdminPermission(session, 'canManageProducts');
    if (!perm.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (!isStripeConfigured()) {
        return NextResponse.json({ error: 'Stripe is not configured (STRIPE_SECRET_KEY missing)' }, { status: 400 });
    }

    const { confirm } = await request.json().catch(() => ({} as { confirm?: boolean }));
    if (confirm !== true) {
        return NextResponse.json({ error: 'Pass {"confirm": true} to rebuild the catalog cache.' }, { status: 400 });
    }

    try {
        const { count } = await rebuildCatalogCache();
        return NextResponse.json({ ok: true, products: count });
    } catch (err) {
        console.error('[catalog rebuild] failed:', err);
        return NextResponse.json({ error: 'Rebuild failed — check server logs.' }, { status: 500 });
    }
}
