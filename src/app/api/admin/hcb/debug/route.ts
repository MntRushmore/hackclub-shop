import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { isAdmin } from '../../../../../lib/adminAuth';
import { diagnoseHcb } from '../../../../../lib/hcb';
import { getGuestOrder } from '../../../../../lib/guestOrders';

/**
 * Admin-only HCB reconciliation diagnostics. Runs the FULL read path with no
 * swallowed errors and reports exactly what's happening:
 *   - token mint + granted scopes
 *   - the raw HTTP status + body from GET /organizations/:id/transactions
 *     (so a 403 not_authorized / invalid scope is visible verbatim)
 *   - every donation the org exposes (amount, state, utm_content)
 *   - for ?orderId=, why that order's donation did or didn't match
 *
 * This is the "why is checkout stuck on Waiting?" answer in one request.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const orderId = new URL(request.url).searchParams.get('orderId') || undefined;

    // If an order is given, pull its expected amount so the match check can
    // verify the donation covers it.
    let expectedAmountCents: number | undefined;
    let orderTotalUsd: number | undefined;
    if (orderId) {
        const order = await getGuestOrder(orderId);
        if (order) {
            orderTotalUsd = order.totalAmount;
            expectedAmountCents = Math.round(order.totalAmount * 100);
        }
    }

    const diagnostics = await diagnoseHcb(orderId, expectedAmountCents);
    return NextResponse.json({
        orderFound: orderId ? orderTotalUsd !== undefined : undefined,
        orderTotalUsd,
        expectedAmountCents,
        ...diagnostics,
    });
}
