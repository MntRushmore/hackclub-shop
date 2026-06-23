import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { getFinanceOverview, Period } from '../../../../../lib/finance';

const VALID: Period[] = ['week', 'month', 'year', 'all'];

/** Finance dashboard data: valuation + COGS/margin + spend + weekly series. */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { searchParams } = new URL(request.url);
        const raw = searchParams.get('period') || 'month';
        const period: Period = (VALID as string[]).includes(raw) ? (raw as Period) : 'month';
        const overview = await getFinanceOverview(period);
        return NextResponse.json(overview);
    } catch (err) {
        console.error('[finance/overview] failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to load finance overview' }, { status: 500 });
    }
}
