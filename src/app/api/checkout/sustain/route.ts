import { NextResponse } from 'next/server';
import { getStripe, isStripeConfigured, NONTAXABLE_TAX_CODE } from '../../../../lib/stripe';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

/**
 * Sustainer checkout (donation pivot, Slice 4): a $25/month recurring donation
 * via Stripe Checkout in subscription mode. No cart, no shipping, no gift per
 * month — the pitch is a members-only annual thank-you gift plus a permanent
 * donor-wall spot, so the whole monthly charge is a pure donation (the price's
 * product carries Stripe's Nontaxable code; treatment pending finance
 * sign-off, see FINANCE_QUESTIONS.md Q1).
 *
 * The donor-wall name is collected as a Stripe Checkout custom field (no shop
 * UI needed); the webhook reads it on `checkout.session.completed` and writes
 * the wall entry server-side. Renewals bump the impact counters via
 * `invoice.paid`.
 */

const SUSTAINER_LOOKUP_KEY = 'sustainer_monthly';
const SUSTAINER_AMOUNT_CENTS = 50000; // $500/mo

export async function POST(request: Request) {
    if (!isStripeConfigured()) {
        return NextResponse.json({ error: 'Card payments are not available right now.' }, { status: 503 });
    }
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`checkout:sustain:${ip}`, { maxRequests: 10, windowMs: 60000 });
    if (!rl.success) return rateLimitResponse();

    try {
        const { email } = (await request.json().catch(() => ({}))) as { email?: string };
        const stripe = getStripe();
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

        // Find-or-create the recurring price by lookup_key, so re-deploys and
        // concurrent requests converge on one price instead of duplicating.
        // Prices are immutable: when the configured amount changes, mint a new
        // Price and move the lookup_key onto it (existing subscribers keep
        // billing on their old price; only new signups get the new amount).
        let priceId: string | undefined;
        const existing = await stripe.prices.list({ lookup_keys: [SUSTAINER_LOOKUP_KEY], limit: 1 });
        const current = existing.data[0];
        if (current && current.unit_amount === SUSTAINER_AMOUNT_CENTS) {
            priceId = current.id;
        } else {
            const productId = current
                ? (typeof current.product === 'string' ? current.product : current.product.id)
                : (await stripe.products.create({
                      name: 'Hack Club Sustainer',
                      description: 'A monthly donation backing teenagers at Hack Club, with a members-only annual thank-you gift.',
                      tax_code: NONTAXABLE_TAX_CODE,
                      metadata: { sustainer: '1' },
                  })).id;
            const price = await stripe.prices.create({
                product: productId,
                currency: 'usd',
                unit_amount: SUSTAINER_AMOUNT_CENTS,
                recurring: { interval: 'month' },
                lookup_key: SUSTAINER_LOOKUP_KEY,
                transfer_lookup_key: true,
                metadata: { sustainer: '1' },
            });
            priceId = price.id;
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            ...(email ? { customer_email: email } : {}),
            // Donor-wall name, collected right on Stripe's page — leave it blank
            // to appear as "Anonymous Sustainer".
            custom_fields: [
                {
                    key: 'donor_wall_name',
                    label: { type: 'custom', custom: 'Name on the donor wall (optional)' },
                    type: 'text',
                    optional: true,
                },
            ],
            metadata: { sustainer: '1' },
            subscription_data: { metadata: { sustainer: '1', fund: 'general' } },
            success_url: `${origin}/thank-you?sustain=1`,
            cancel_url: `${origin}/shop`,
        });

        return NextResponse.json({ url: session.url });
    } catch (error) {
        console.error('[Sustain Checkout] Error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
    }
}
