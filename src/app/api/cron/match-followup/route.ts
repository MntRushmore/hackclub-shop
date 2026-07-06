import { NextResponse } from 'next/server';
import { getGuestOrder, updateGuestOrder } from '../../../../lib/guestOrders';
import { getDonationOrderIdsBetween } from '../../../../lib/donorWall';
import { sendEmail, buildMatchFollowup, isEmailConfigured } from '../../../../lib/email';
import { isMarketingSuppressed } from '../../../../lib/emailSuppression';

/**
 * Employer-match follow-up cron (donation pivot, Slice 4). Runs daily via
 * Vercel Cron (see vercel.json): finds donation orders that settled 3–14 days
 * ago, and sends each donor ONE follow-up nudging them to check their
 * employer's matching-gift portal — the single highest-leverage growth email
 * (a match doubles the donation at zero cost).
 *
 * Guarantees:
 *  - one send per order, ever: `donation.matchEmailSentAt` is stamped on the
 *    order before counting a send, and stamped even when the provider is down
 *    at send time is NOT done (failed sends retry next run).
 *  - marketing suppression respected (this is not a receipt).
 *  - the 3-day lower bound keeps it out of the receipt's shadow; the 14-day
 *    upper bound stops ancient orders from suddenly getting mail if the cron
 *    was paused.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Without the
 * env set, the route refuses to run (fail closed).
 */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isEmailConfigured()) {
        return NextResponse.json({ ok: true, skipped: 'email provider not configured' });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const ids = await getDonationOrderIdsBetween(now - 14 * DAY, now - 3 * DAY);

    let sent = 0;
    let skipped = 0;
    for (const id of ids) {
        try {
            const order = await getGuestOrder(id);
            if (
                !order ||
                !order.donation ||
                order.donation.matchEmailSentAt ||
                order.paymentStatus !== 'paid' ||
                !order.guestEmail ||
                order.isTest
            ) {
                skipped++;
                continue;
            }
            if (await isMarketingSuppressed(order.guestEmail)) {
                // Suppressed donors are stamped too, so we never re-evaluate them.
                await updateGuestOrder(id, { donation: { ...order.donation, matchEmailSentAt: new Date().toISOString() } });
                skipped++;
                continue;
            }
            const delivered = await sendEmail(buildMatchFollowup(order, order.guestEmail));
            if (delivered) {
                await updateGuestOrder(id, { donation: { ...order.donation, matchEmailSentAt: new Date().toISOString() } });
                sent++;
            } else {
                skipped++; // provider hiccup: left unstamped, retried on the next run
            }
        } catch (err) {
            console.error('[cron/match-followup] failed for', id, ':', err instanceof Error ? err.message : err);
            skipped++;
        }
    }

    return NextResponse.json({ ok: true, scanned: ids.length, sent, skipped });
}
