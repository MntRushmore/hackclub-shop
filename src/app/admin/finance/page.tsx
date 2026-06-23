'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

// ── Types mirrored from src/lib/finance.ts (kept loose; this is a display layer) ──
type Period = 'week' | 'month' | 'year' | 'all';

interface ValuationRow {
    productId: string; variantId: string; productName: string; variantName: string;
    category?: string; onHand: number | null; unitCost: number | null; value: number; costed: boolean;
}
interface Valuation {
    rows: ValuationRow[]; totalValue: number; totalUnits: number; trackedVariants: number;
    costedVariants: number; uncostedVariants: number; untrackedVariants: number;
    byCategory: Array<{ category: string; value: number; units: number }>;
}
interface MarginProductRow { name: string; variantId?: string; unitsSold: number; revenue: number; cogs: number; margin: number; marginPct: number | null; }
interface CogsAndMargin {
    period: Period; cashRevenue: number; cashCogs: number; cashMargin: number; cashMarginPct: number | null;
    pointsCogs: number; pointsSpent: number; pointsOrders: number; totalCogs: number; unitsSold: number;
    ordersCounted: number; estimatedLineShare: number; topByMargin: MarginProductRow[]; bottomByMargin: MarginProductRow[];
}
interface Spend { totalSpend: number; receiptCount: number; unitsReceived: number; }
interface WeekPoint { week: string; weekStart: string; cashRevenue: number; cashCogs: number; cashMargin: number; pointsCogs: number; spend: number; unitsSold: number; unitsReceived: number; orders: number; }
interface Overview { period: Period; valuation: Valuation; margin: CogsAndMargin; spend: Spend; weeklySeries: WeekPoint[]; generatedAt: string; }

interface Receipt {
    id: string; productName: string; variantName: string; quantity: number; unitCost: number;
    totalCost: number; avgCostAfter: number; stockAfter: number | null; receivedAt: string; actorEmail?: string; note?: string;
}
interface WeeklyReport {
    week: string; weekStart: string; weekEnd: string; unitsSold: number; cashRevenue: number; cashCogs: number;
    cashMargin: number; cashMarginPct: number | null; pointsCogs: number; pointsSpent: number; orders: number;
    unitsReceived: number; spend: number; receiptCount: number; endingInventoryValue: number; uncostedVariants: number;
    lowStock: Array<{ variantId: string; productName: string; variantName: string; available: number | null }>;
    deadStock: Array<{ variantId: string; productName: string; variantName: string; onHand: number; value: number; lastSold: string | null }>;
}

const usd = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIODS: { id: Period; label: string }[] = [
    { id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }, { id: 'year', label: '1 year' }, { id: 'all', label: 'All time' },
];

export default function FinanceAdmin() {
    const { data: session, status } = useSession();
    const [period, setPeriod] = useState<Period>('month');
    const [data, setData] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: '/admin/finance' });
    }, [status]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/finance/overview?period=${period}`);
            if (!res.ok) {
                setError(res.status === 403 ? 'You don’t have permission to view finance.' : 'Failed to load finance data');
                return;
            }
            setData(await res.json());
        } catch {
            setError('Failed to load finance data');
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => { if (session) load(); }, [session, load]);

    if (status === 'loading' || (session && loading && !data)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading…</div>
            </div>
        );
    }
    if (!session) return null;

    return (
        <div className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: 'linear-gradient(to right, #e0f2fe 1px, transparent 1px), linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)',
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">← Back to Dashboard</Link>
                    <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
                        <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark">Finance</h1>
                        <div className="flex gap-2">
                            {PERIODS.map((p) => (
                                <button key={p.id} type="button" onClick={() => setPeriod(p.id)}
                                    className={`px-4 py-2 rounded-full text-sm font-bold border-2 transition-colors ${period === p.id ? 'bg-hackclub-blue text-white border-hackclub-blue' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <p className="text-lg text-hackclub-slate font-medium mb-6">
                        On-hand value, cost of goods, margins, purchasing spend, and the weekly report. Cost basis is weighted-average per variant — see <Link href="/admin/inventory" className="text-hackclub-blue hover:underline font-bold">Inventory</Link> for units.
                    </p>

                    {error && (
                        <div className="mb-4 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </div>
                    )}

                    {data && (
                        <>
                            <KpiGrid data={data} />
                            <ChartsRow data={data} />
                            <ValuationPanel valuation={data.valuation} />
                            <MarginPanel margin={data.margin} />
                            <WeeklyPanel onReceived={load} />
                            <ReceivingPanel rows={data.valuation.rows} onReceived={load} />
                        </>
                    )}
                </motion.div>
            </div>
        </div>
    );
}

// ── KPI cards ────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, tone = 'dark' }: { label: string; value: string; sub?: string; tone?: 'dark' | 'green' | 'red' | 'blue' | 'orange' }) {
    const toneClass = {
        dark: 'text-hackclub-dark', green: 'text-hackclub-green', red: 'text-hackclub-red', blue: 'text-hackclub-blue', orange: 'text-hackclub-orange',
    }[tone];
    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-5">
            <div className="text-xs font-black uppercase text-hackclub-muted tracking-wide">{label}</div>
            <div className={`text-3xl font-black mt-1 ${toneClass}`}>{value}</div>
            {sub && <div className="text-sm text-hackclub-slate font-medium mt-1">{sub}</div>}
        </div>
    );
}

function KpiGrid({ data }: { data: Overview }) {
    const { valuation, margin, spend } = data;
    const marginTone = margin.cashMargin >= 0 ? 'green' : 'red';
    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <Kpi label="Inventory value" value={usd(valuation.totalValue)} sub={`${valuation.totalUnits.toLocaleString()} units on hand`} tone="blue" />
            <Kpi label="Cash revenue" value={usd(margin.cashRevenue)} sub={`${margin.ordersCounted} orders`} />
            <Kpi label="Cost of goods" value={usd(margin.cashCogs)} sub={margin.pointsCogs > 0 ? `+ ${usd(margin.pointsCogs)} points fulfilment` : 'cash pathway'} tone="orange" />
            <Kpi label="Gross margin" value={usd(margin.cashMargin)} sub={margin.cashMarginPct === null ? 'no cash sales' : `${margin.cashMarginPct.toFixed(1)}% of revenue`} tone={marginTone} />
            <Kpi label="Purchasing spend" value={usd(spend.totalSpend)} sub={`${spend.unitsReceived.toLocaleString()} units received`} tone="red" />
            <Kpi label="Cost coverage" value={`${valuation.trackedVariants ? Math.round((valuation.costedVariants / valuation.trackedVariants) * 100) : 0}%`} sub={valuation.uncostedVariants > 0 ? `${valuation.uncostedVariants} variants uncosted` : 'all stock costed'} tone={valuation.uncostedVariants > 0 ? 'orange' : 'green'} />
        </div>
    );
}

// ── Charts row ───────────────────────────────────────────────────────────────
function ChartsRow({ data }: { data: Overview }) {
    const series = data.weeklySeries;
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card title="Weekly gross margin (cash)" subtitle="Revenue − COGS, last 12 weeks">
                <WeeklyMarginChart series={series} />
            </Card>
            <Card title="Spend vs cash revenue" subtitle="Purchasing outflow against sales inflow, last 12 weeks">
                <SpendVsRevenueChart series={series} />
            </Card>
            <Card title="Top products by margin" subtitle={`${PERIODS.find((p) => p.id === data.period)?.label}`}>
                <MarginBars rows={data.margin.topByMargin} />
            </Card>
            <Card title="Inventory value by category" subtitle="Current on-hand valuation">
                <CategoryBars cats={data.valuation.byCategory} />
            </Card>
        </div>
    );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-5">
            <h3 className="text-lg font-black text-hackclub-dark">{title}</h3>
            {subtitle && <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide mb-3">{subtitle}</p>}
            {children}
        </div>
    );
}

// Diverging bar chart: margin can go negative, so baseline sits at zero.
function WeeklyMarginChart({ series }: { series: WeekPoint[] }) {
    const max = Math.max(1, ...series.map((s) => Math.abs(s.cashMargin)));
    return (
        <div className="overflow-x-auto">
            <div className="flex items-stretch gap-1.5 h-48" style={{ minWidth: `${series.length * 28}px` }}>
                {series.map((s) => {
                    const pos = s.cashMargin >= 0;
                    const h = (Math.abs(s.cashMargin) / max) * 50;
                    return (
                        <div key={s.week} className="flex-1 flex flex-col items-center group" style={{ minWidth: '18px' }}
                            title={`${s.weekStart}: margin ${usd(s.cashMargin)} (rev ${usd(s.cashRevenue)} − COGS ${usd(s.cashCogs)})`}>
                            <div className="flex-1 w-full flex items-end justify-center">
                                {pos && <div className="w-full bg-hackclub-green/80 group-hover:bg-hackclub-green rounded-t transition-colors" style={{ height: `${Math.max(2, h)}%` }} />}
                            </div>
                            <div className="w-full h-px bg-hackclub-smoke" />
                            <div className="flex-1 w-full flex items-start justify-center">
                                {!pos && s.cashMargin < 0 && <div className="w-full bg-hackclub-red/80 group-hover:bg-hackclub-red rounded-b transition-colors" style={{ height: `${Math.max(2, h)}%` }} />}
                            </div>
                            <span className="text-[8px] text-hackclub-muted mt-0.5 whitespace-nowrap">{s.weekStart.slice(5)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Paired bars: spend (red) vs revenue (blue) per week.
function SpendVsRevenueChart({ series }: { series: WeekPoint[] }) {
    const max = Math.max(1, ...series.map((s) => Math.max(s.spend, s.cashRevenue)));
    return (
        <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 h-48" style={{ minWidth: `${series.length * 28}px` }}>
                {series.map((s) => (
                    <div key={s.week} className="flex-1 flex flex-col items-center justify-end" style={{ minWidth: '18px' }}>
                        <div className="w-full flex items-end justify-center gap-0.5 h-full">
                            <div className="w-1/2 bg-hackclub-blue/80 hover:bg-hackclub-blue rounded-t transition-colors" style={{ height: `${Math.max(1, (s.cashRevenue / max) * 100)}%` }} title={`${s.weekStart}: revenue ${usd(s.cashRevenue)}`} />
                            <div className="w-1/2 bg-hackclub-red/70 hover:bg-hackclub-red rounded-t transition-colors" style={{ height: `${Math.max(1, (s.spend / max) * 100)}%` }} title={`${s.weekStart}: spend ${usd(s.spend)}`} />
                        </div>
                        <span className="text-[8px] text-hackclub-muted mt-0.5 whitespace-nowrap">{s.weekStart.slice(5)}</span>
                    </div>
                ))}
            </div>
            <div className="flex gap-4 mt-3 text-xs font-bold text-hackclub-slate">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-hackclub-blue/80 inline-block" /> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-hackclub-red/70 inline-block" /> Spend</span>
            </div>
        </div>
    );
}

function MarginBars({ rows }: { rows: MarginProductRow[] }) {
    if (!rows.length) return <Empty>No sales in this period.</Empty>;
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.margin)));
    return (
        <div className="space-y-2">
            {rows.map((r) => (
                <div key={(r.variantId || r.name)} className="flex items-center gap-2 text-sm">
                    <div className="w-32 truncate font-medium text-hackclub-dark" title={r.name}>{r.name}</div>
                    <div className="flex-1 bg-hackclub-snow rounded h-5 overflow-hidden">
                        <div className={`h-full ${r.margin >= 0 ? 'bg-hackclub-green/80' : 'bg-hackclub-red/80'}`} style={{ width: `${Math.max(2, (Math.abs(r.margin) / max) * 100)}%` }} />
                    </div>
                    <div className="w-20 text-right font-mono font-bold text-hackclub-dark">{usd(r.margin)}</div>
                </div>
            ))}
        </div>
    );
}

function CategoryBars({ cats }: { cats: Array<{ category: string; value: number; units: number }> }) {
    if (!cats.length) return <Empty>No costed inventory yet.</Empty>;
    const max = Math.max(1, ...cats.map((c) => c.value));
    return (
        <div className="space-y-2">
            {cats.map((c) => (
                <div key={c.category} className="flex items-center gap-2 text-sm">
                    <div className="w-32 truncate font-medium text-hackclub-dark" title={c.category}>{c.category}</div>
                    <div className="flex-1 bg-hackclub-snow rounded h-5 overflow-hidden">
                        <div className="h-full bg-hackclub-blue/80" style={{ width: `${Math.max(2, (c.value / max) * 100)}%` }} title={`${c.units} units`} />
                    </div>
                    <div className="w-20 text-right font-mono font-bold text-hackclub-dark">{usd(c.value)}</div>
                </div>
            ))}
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <div className="py-8 text-center text-hackclub-muted font-bold">{children}</div>;
}

// ── Valuation table ────────────────────────────────────────────────────────────
function ValuationPanel({ valuation }: { valuation: Valuation }) {
    const [showAll, setShowAll] = useState(false);
    const [uncostedOnly, setUncostedOnly] = useState(false);
    const rows = useMemo(() => {
        let r = valuation.rows;
        if (uncostedOnly) r = r.filter((x) => x.onHand !== null && x.onHand > 0 && !x.costed);
        return showAll ? r : r.slice(0, 15);
    }, [valuation.rows, showAll, uncostedOnly]);

    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b-2 border-hackclub-smoke">
                <div>
                    <h3 className="text-lg font-black text-hackclub-dark">Inventory valuation</h3>
                    <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide">On-hand units × weighted-avg cost</p>
                </div>
                <button type="button" onClick={() => setUncostedOnly((v) => !v)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors ${uncostedOnly ? 'bg-hackclub-orange text-white border-hackclub-orange' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}>
                    Uncosted only
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-hackclub-snow border-b-2 border-hackclub-smoke">
                        <tr className="text-left text-hackclub-muted font-black uppercase text-xs">
                            <th className="px-4 py-3">Product / Variant</th>
                            <th className="px-4 py-3 text-right">On hand</th>
                            <th className="px-4 py-3 text-right">Unit cost</th>
                            <th className="px-4 py-3 text-right">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-hackclub-muted font-bold">No variants{uncostedOnly ? ' are uncosted' : ''}.</td></tr>
                        ) : rows.map((r) => (
                            <tr key={r.variantId} className="border-b border-hackclub-smoke last:border-0">
                                <td className="px-4 py-3">
                                    <div className="font-bold text-hackclub-dark">{r.productName}</div>
                                    <div className="text-hackclub-muted">{r.variantName}</div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{r.onHand === null ? <span className="text-hackclub-muted">∞</span> : r.onHand}</td>
                                <td className="px-4 py-3 text-right font-mono">
                                    {r.unitCost === null ? <span className="px-2 py-0.5 rounded-full text-xs font-black bg-hackclub-orange/20 text-hackclub-orange">uncosted</span> : usd(r.unitCost)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-hackclub-dark">{r.value > 0 ? usd(r.value) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-hackclub-snow border-t-2 border-hackclub-smoke font-black">
                            <td className="px-4 py-3 text-hackclub-dark">Total</td>
                            <td className="px-4 py-3 text-right font-mono">{valuation.totalUnits.toLocaleString()}</td>
                            <td />
                            <td className="px-4 py-3 text-right font-mono text-hackclub-blue">{usd(valuation.totalValue)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            {valuation.rows.length > 15 && (
                <div className="px-5 py-3 border-t border-hackclub-smoke text-center">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-hackclub-blue hover:underline font-bold text-sm">
                        {showAll ? 'Show top 15' : `Show all ${valuation.rows.length} variants`}
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Margin breakdown (top + bottom) ──────────────────────────────────────────────
function MarginPanel({ margin }: { margin: CogsAndMargin }) {
    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-5 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-lg font-black text-hackclub-dark">Margin by product</h3>
                {margin.estimatedLineShare > 0 && (
                    <span className="text-xs font-bold text-hackclub-orange bg-hackclub-orange/10 px-3 py-1 rounded-full">
                        {Math.round(margin.estimatedLineShare * 100)}% of sold lines use estimated cost
                    </span>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <MarginList title="Best margin" rows={margin.topByMargin} />
                <MarginList title="Worst margin" rows={margin.bottomByMargin} />
            </div>
        </div>
    );
}

function MarginList({ title, rows }: { title: string; rows: MarginProductRow[] }) {
    return (
        <div>
            <div className="text-xs font-black uppercase text-hackclub-muted tracking-wide mb-2">{title}</div>
            {rows.length === 0 ? <Empty>No data.</Empty> : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-hackclub-muted font-bold text-xs">
                            <th className="py-1">Product</th><th className="py-1 text-right">Units</th><th className="py-1 text-right">Revenue</th><th className="py-1 text-right">Margin</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.variantId || r.name} className="border-t border-hackclub-smoke">
                                <td className="py-1.5 font-medium text-hackclub-dark truncate max-w-[160px]" title={r.name}>{r.name}</td>
                                <td className="py-1.5 text-right font-mono">{r.unitsSold}</td>
                                <td className="py-1.5 text-right font-mono">{usd(r.revenue)}</td>
                                <td className={`py-1.5 text-right font-mono font-bold ${r.margin >= 0 ? 'text-hackclub-green' : 'text-hackclub-red'}`}>{usd(r.margin)}{r.marginPct !== null ? <span className="text-hackclub-muted font-normal"> ({r.marginPct}%)</span> : null}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// ── Weekly report ────────────────────────────────────────────────────────────
function WeeklyPanel({ onReceived }: { onReceived: () => void }) {
    const [week, setWeek] = useState<string>(() => new Date().toISOString().slice(0, 10));
    const [report, setReport] = useState<WeeklyReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    // onReceived is unused here but kept for symmetry; weekly is read-only.
    void onReceived;

    const load = useCallback(async (w: string) => {
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`/api/admin/finance/weekly?week=${w}`);
            if (!res.ok) { setErr('Failed to load weekly report'); return; }
            setReport(await res.json());
        } catch { setErr('Failed to load weekly report'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(week); }, [week, load]);

    const shiftWeek = (deltaDays: number) => {
        const d = new Date(week); d.setDate(d.getDate() + deltaDays); setWeek(d.toISOString().slice(0, 10));
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-5 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-lg font-black text-hackclub-dark">Weekly report</h3>
                    <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide">{report ? `${report.week} · ${report.weekStart} → ${report.weekEnd}` : 'Loading…'}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => shiftWeek(-7)} className="px-3 py-1.5 rounded-full text-sm font-bold border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate">← Prev</button>
                    <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} className="rounded-lg border-2 border-hackclub-smoke px-2 py-1 text-sm font-medium focus:outline-none focus:border-hackclub-blue" />
                    <button type="button" onClick={() => shiftWeek(7)} className="px-3 py-1.5 rounded-full text-sm font-bold border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate">Next →</button>
                    <a href={`/api/admin/finance/weekly/export?week=${week}`} className="px-4 py-1.5 rounded-full text-sm font-bold bg-hackclub-green hover:bg-green-600 text-white transition-colors">Export CSV</a>
                </div>
            </div>

            {err && <p className="text-hackclub-red font-bold">{err}</p>}
            {loading && !report && <Empty>Loading…</Empty>}
            {report && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                        <MiniStat label="Orders" value={String(report.orders)} />
                        <MiniStat label="Units sold" value={String(report.unitsSold)} />
                        <MiniStat label="Cash revenue" value={usd(report.cashRevenue)} />
                        <MiniStat label="COGS" value={usd(report.cashCogs)} />
                        <MiniStat label="Margin" value={usd(report.cashMargin)} tone={report.cashMargin >= 0 ? 'green' : 'red'} />
                        <MiniStat label="Units received" value={String(report.unitsReceived)} />
                        <MiniStat label="Spend" value={usd(report.spend)} tone="red" />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <FlagList title={`Low stock (${report.lowStock.length})`} empty="Nothing low." tone="orange">
                            {report.lowStock.map((l) => (
                                <li key={l.variantId} className="flex justify-between gap-2 py-1 border-b border-hackclub-smoke last:border-0">
                                    <span className="truncate text-hackclub-dark font-medium">{l.productName} · {l.variantName}</span>
                                    <span className="font-mono font-bold text-hackclub-orange">{l.available ?? '∞'}</span>
                                </li>
                            ))}
                        </FlagList>
                        <FlagList title={`Dead stock (${report.deadStock.length})`} empty="Nothing stale." tone="red">
                            {report.deadStock.map((d) => (
                                <li key={d.variantId} className="flex justify-between gap-2 py-1 border-b border-hackclub-smoke last:border-0">
                                    <span className="truncate text-hackclub-dark font-medium">{d.productName} · {d.variantName} <span className="text-hackclub-muted">({d.lastSold || 'never sold'})</span></span>
                                    <span className="font-mono font-bold text-hackclub-red">{usd(d.value)}</span>
                                </li>
                            ))}
                        </FlagList>
                    </div>
                </>
            )}
        </div>
    );
}

function MiniStat({ label, value, tone = 'dark' }: { label: string; value: string; tone?: 'dark' | 'green' | 'red' }) {
    const c = { dark: 'text-hackclub-dark', green: 'text-hackclub-green', red: 'text-hackclub-red' }[tone];
    return (
        <div className="bg-hackclub-snow rounded-xl p-3">
            <div className="text-[10px] font-black uppercase text-hackclub-muted tracking-wide">{label}</div>
            <div className={`text-lg font-black mt-0.5 ${c}`}>{value}</div>
        </div>
    );
}

function FlagList({ title, tone, empty, children }: { title: string; tone: 'orange' | 'red'; empty: string; children: React.ReactNode }) {
    const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
    const dot = tone === 'orange' ? 'bg-hackclub-orange' : 'bg-hackclub-red';
    return (
        <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase text-hackclub-muted tracking-wide mb-2">
                <span className={`w-2 h-2 rounded-full ${dot}`} />{title}
            </div>
            {hasItems ? <ul className="text-sm max-h-56 overflow-y-auto">{children}</ul> : <Empty>{empty}</Empty>}
        </div>
    );
}

// ── Receiving form + recent receipts ──────────────────────────────────────────
function ReceivingPanel({ rows, onReceived }: { rows: ValuationRow[]; onReceived: () => void }) {
    const [variantId, setVariantId] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unitCost, setUnitCost] = useState('');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [receipts, setReceipts] = useState<Receipt[]>([]);

    const selected = rows.find((r) => r.variantId === variantId);

    const loadReceipts = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/finance/receiving');
            if (res.ok) setReceipts((await res.json()).receipts || []);
        } catch { /* best-effort */ }
    }, []);
    useEffect(() => { loadReceipts(); }, [loadReceipts]);

    // Prefill the cost field with the variant's current avg cost as a sensible default.
    useEffect(() => {
        if (selected && selected.unitCost !== null) setUnitCost(String(selected.unitCost));
    }, [selected]);

    const submit = async () => {
        setErr(null); setMsg(null);
        if (!selected) { setErr('Pick a variant.'); return; }
        const qty = parseInt(quantity, 10);
        const cost = parseFloat(unitCost);
        if (!Number.isFinite(qty) || qty <= 0) { setErr('Quantity must be a positive whole number.'); return; }
        if (!Number.isFinite(cost) || cost < 0) { setErr('Unit cost must be zero or more.'); return; }
        setSubmitting(true);
        // Idempotency key so a double-click can't double-count.
        const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        try {
            const res = await fetch('/api/admin/finance/receiving', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: selected.productId, variantId: selected.variantId, quantity: qty, unitCost: cost, note: note.trim() || undefined, receiptId }),
            });
            const data = await res.json();
            if (!res.ok) { setErr(data.error || 'Could not record receipt.'); return; }
            setMsg(`Received ${qty} × ${selected.productName} · ${selected.variantName}. New avg cost ${usd(data.receipt.avgCostAfter)}.`);
            setQuantity(''); setNote('');
            await loadReceipts();
            onReceived(); // refresh KPIs/valuation
        } catch {
            setErr('Could not record receipt.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-5 mb-6">
            <h3 className="text-lg font-black text-hackclub-dark">Receive stock</h3>
            <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide mb-4">Records a purchase, blends weighted-avg cost, and adds units to stock</p>

            {err && <div className="mb-3 p-3 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl text-hackclub-red font-bold text-sm">{err}</div>}
            {msg && <div className="mb-3 p-3 bg-hackclub-green/10 border-2 border-hackclub-green/40 rounded-xl text-hackclub-green font-bold text-sm">{msg}</div>}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-5">
                    <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Variant</label>
                    <select value={variantId} onChange={(e) => setVariantId(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-medium">
                        <option value="">Select a variant…</option>
                        {rows.map((r) => (
                            <option key={r.variantId} value={r.variantId}>
                                {r.productName} · {r.variantName}{r.onHand !== null ? ` (${r.onHand} on hand)` : ''}{r.unitCost !== null ? ` · ${usd(r.unitCost)}` : ' · uncosted'}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Quantity</label>
                    <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0"
                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-mono" />
                </div>
                <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Unit cost ($)</label>
                    <input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00"
                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-mono" />
                </div>
                <div className="md:col-span-3">
                    <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Note (optional)</label>
                    <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="PO #, supplier…"
                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-medium" />
                </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-hackclub-slate font-medium">
                    {selected && quantity && unitCost && Number(quantity) > 0
                        ? <>Total spend <span className="font-bold text-hackclub-dark">{usd(parseInt(quantity, 10) * parseFloat(unitCost || '0'))}</span>{selected.unitCost !== null && <> · current avg {usd(selected.unitCost)}</>}</>
                        : 'Pick a variant, quantity, and unit cost.'}
                </p>
                <button type="button" onClick={submit} disabled={submitting}
                    className="px-6 py-2.5 rounded-full font-bold text-white bg-hackclub-blue hover:bg-blue-600 transition-colors disabled:opacity-50">
                    {submitting ? 'Recording…' : 'Receive stock'}
                </button>
            </div>

            {receipts.length > 0 && (
                <div className="mt-6">
                    <div className="text-xs font-black uppercase text-hackclub-muted tracking-wide mb-2">Recent receipts</div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-hackclub-muted font-bold text-xs border-b border-hackclub-smoke">
                                    <th className="py-2">When</th><th className="py-2">Product / Variant</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit cost</th><th className="py-2 text-right">Total</th><th className="py-2 text-right">New avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {receipts.slice(0, 20).map((r) => (
                                    <tr key={r.id} className="border-b border-hackclub-smoke last:border-0">
                                        <td className="py-2 text-hackclub-muted whitespace-nowrap">{new Date(r.receivedAt).toLocaleDateString()}</td>
                                        <td className="py-2 font-medium text-hackclub-dark">{r.productName} · {r.variantName}{r.note ? <span className="text-hackclub-muted"> — {r.note}</span> : null}</td>
                                        <td className="py-2 text-right font-mono">{r.quantity}</td>
                                        <td className="py-2 text-right font-mono">{usd(r.unitCost)}</td>
                                        <td className="py-2 text-right font-mono">{usd(r.totalCost)}</td>
                                        <td className="py-2 text-right font-mono font-bold text-hackclub-dark">{usd(r.avgCostAfter)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
