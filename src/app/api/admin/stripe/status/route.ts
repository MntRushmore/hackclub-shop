import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin } from '../../../../../lib/adminAuth';
import {
    getStripe,
    isStripeConfigured,
    isStripeTaxEnabled,
    webhookSecretFor,
    getGlobalStripeMode,
    getAdminStripeMode,
    type StripeMode,
} from '../../../../../lib/stripe';

/**
 * Admin-only: Stripe config + health for the finance page. Stripe is the guest
 * checkout processor (since the HCB migration on 2026-06-24), so this reports
 * everything that has to be true for money to land correctly, for BOTH key
 * slots (live + test):
 *  - `configured`: the slot's secret key is set (checkout sessions can be created)
 *  - `reachable`: the key was accepted by Stripe just now (a live API read)
 *  - `webhookConfigured`: the slot's webhook secret is set — without it payments
 *    succeed on Stripe but orders are never finalized (the webhook is the only
 *    trusted paid signal)
 *  - `livemode` / `taxEnabled`: which kind of key is loaded and whether Stripe
 *    Tax adds sales tax at checkout
 * plus the current checkout mode (global + the caller's personal override).
 */

interface SlotStatus {
    configured: boolean;
    reachable: boolean;
    livemode: boolean;
    taxEnabled: boolean;
    webhookConfigured: boolean;
    account: { id: string; name: string | null; email: string | null } | null;
}

async function slotStatus(mode: StripeMode): Promise<SlotStatus> {
    const configured = isStripeConfigured(mode);
    const key = (mode === 'test' ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY) || '';

    let reachable = false;
    let account: SlotStatus['account'] = null;
    if (configured) {
        try {
            // Retrieve our own platform account (id: null) — the cheapest
            // authenticated read, and it doubles as identity for the card.
            const acct = await getStripe(mode).accounts.retrieve(null);
            reachable = true;
            account = {
                id: acct.id,
                name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || null,
                email: acct.email || null,
            };
        } catch {
            // Key present but rejected/unreachable; the card surfaces this state.
            reachable = false;
        }
    }

    return {
        configured,
        reachable,
        livemode: key.startsWith('sk_live_') || key.startsWith('rk_live_'),
        taxEnabled: isStripeTaxEnabled(mode),
        webhookConfigured: Boolean(webhookSecretFor(mode)),
        account,
    };
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [live, test, global, personal] = await Promise.all([
        slotStatus('live'),
        slotStatus('test'),
        getGlobalStripeMode(),
        getAdminStripeMode(session!.user!.id!),
    ]);

    return NextResponse.json({
        // Top-level fields mirror the live slot (pre-toggle response shape).
        ...live,
        test,
        mode: { global, personal, effective: personal || global },
    });
}
