import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getWeeklyReport } from '../../../../../../lib/finance';

/**
 * Weekly finance report as a CSV download. Same formula-injection-safe escaping
 * the orders export uses: a leading =,+,-,@ is prefixed with ' so a spreadsheet
 * treats the cell as text, never a formula.
 */
function esc(v: unknown): string {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageFinance');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { searchParams } = new URL(request.url);
        const weekParam = searchParams.get('week');
        const date = weekParam ? new Date(weekParam) : new Date();
        const when = Number.isNaN(date.getTime()) ? new Date() : date;
        const r = await getWeeklyReport(when);

        const lines: string[][] = [
            ['Hack Club Shop — Weekly Finance Report'],
            ['Week', r.week, `${r.weekStart} to ${r.weekEnd}`],
            [],
            ['Sales'],
            ['Metric', 'Value'],
            ['Orders', String(r.orders)],
            ['Units sold', String(r.unitsSold)],
            ['Cash revenue (USD)', r.cashRevenue.toFixed(2)],
            ['Cash COGS (USD)', r.cashCogs.toFixed(2)],
            ['Cash gross margin (USD)', r.cashMargin.toFixed(2)],
            ['Cash gross margin (%)', r.cashMarginPct === null ? 'n/a' : r.cashMarginPct.toFixed(1)],
            ['Points COGS (USD)', r.pointsCogs.toFixed(2)],
            ['Points spent', String(r.pointsSpent)],
            [],
            ['Purchasing'],
            ['Receipts', String(r.receiptCount)],
            ['Units received', String(r.unitsReceived)],
            ['Spend (USD)', r.spend.toFixed(2)],
            [],
            ['Position at report time'],
            ['Ending inventory value (USD)', r.endingInventoryValue.toFixed(2)],
            ['Uncosted variants', String(r.uncostedVariants)],
            [],
            ['Low stock (≤5 available)'],
            ['Product', 'Variant', 'Available'],
            ...r.lowStock.map((l) => [l.productName, l.variantName, l.available === null ? '∞' : String(l.available)]),
            [],
            [`Dead stock (no sale in 8 weeks, holding value)`],
            ['Product', 'Variant', 'On hand', 'Value (USD)', 'Last sold'],
            ...r.deadStock.map((d) => [d.productName, d.variantName, String(d.onHand), d.value.toFixed(2), d.lastSold || 'never']),
        ];

        const csv = lines.map((row) => row.map(esc).join(',')).join('\n');
        return new NextResponse(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv;charset=utf-8;',
                'Content-Disposition': `attachment; filename="finance-week-${r.week}.csv"`,
            },
        });
    } catch (err) {
        console.error('[finance/weekly/export] failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to export weekly report' }, { status: 500 });
    }
}
