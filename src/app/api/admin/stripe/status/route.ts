import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin } from '../../../../../lib/adminAuth';
import { getStripe, isStripeConfigured, isStripeTaxEnabled } from '../../../../../lib/stripe';

/**
 * Admin-only: Stripe config + health for the finance page. Stripe is the guest
 * checkout processor (since the HCB migration on 2026-06-24), so this reports
 * everything that has to be true for money to land correctly:
 *  - `configured`: STRIPE_SECRET_KEY is set (checkout sessions can be created)
 *  - `reachable`: the key was accepted by Stripe just now (a live API read)
 *  - `webhookConfigured`: STRIPE_WEBHOOK_SECRET is set — without it payments
 *    succeed on Stripe but orders are never finalized (the webhook is the only
 *    trusted paid signal)
 *  - `livemode` / `taxEnabled`: which key is loaded and whether Stripe Tax
 *    adds sales tax at checkout
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const configured = isStripeConfigured();
    const key = process.env.STRIPE_SECRET_KEY || '';

    let reachable = false;
    let account: { id: string; name: string | null; email: string | null } | null = null;
    if (configured) {
        try {
            // Retrieve our own platform account (id: null) — the cheapest
            // authenticated read, and it doubles as identity for the card.
            const acct = await getStripe().accounts.retrieve(null);
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

    return NextResponse.json({
        configured,
        reachable,
        livemode: key.startsWith('sk_live_') || key.startsWith('rk_live_'),
        taxEnabled: isStripeTaxEnabled(),
        webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        account,
    });
}
