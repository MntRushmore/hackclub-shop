import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { getWeeklyReport } from '../../../../../lib/finance';

/**
 * Weekly finance report (JSON). `?week=YYYY-MM-DD` selects any date inside the
 * desired ISO week; omit for the current week. The CSV form lives at
 * /api/admin/finance/weekly/export.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { searchParams } = new URL(request.url);
        const weekParam = searchParams.get('week');
        const date = weekParam ? new Date(weekParam) : new Date();
        const when = Number.isNaN(date.getTime()) ? new Date() : date;
        const report = await getWeeklyReport(when);
        return NextResponse.json(report);
    } catch (err) {
        console.error('[finance/weekly] failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to build weekly report' }, { status: 500 });
    }
}
