'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Label, { LABEL_TEMPLATES, LabelStyle } from './Label';
import ScanTester from './ScanTester';
import TestSheet, { TestSheetItem } from './TestSheet';

interface VariantRow {
    productId: string;
    productName: string;
    category?: string;
    draft: boolean;
    variantId: string;
    variantName: string;
    size?: string;
    color?: string;
    sku: string | null;
    scanCode: string | null;
    suggestedSku: string;
    stock: number | null;
    available: number | null;
}

const ACCENTS = [
    { name: 'Red', value: '#ec3750' },
    { name: 'Blue', value: '#338eda' },
    { name: 'Green', value: '#33d6a6' },
    { name: 'Orange', value: '#ff8c37' },
    { name: 'Purple', value: '#a633d6' },
    { name: 'Dark', value: '#17171d' },
];

function LabelsDesigner() {
    const { data: session, status } = useSession();
    const searchParams = useSearchParams();
    const preselectVariant = searchParams.get('variant');

    const [rows, setRows] = useState<VariantRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ---- design state ----
    const [style, setStyle] = useState<LabelStyle>({
        showLogo: true,
        logo: 'bag',
        showProductName: true,
        showVariant: true,
        showSku: true,
        accent: '#ec3750',
    });
    const [templateId, setTemplateId] = useState(LABEL_TEMPLATES[0].id);
    const template = useMemo(() => LABEL_TEMPLATES.find(t => t.id === templateId) || LABEL_TEMPLATES[0], [templateId]);

    // ---- playground payload ----
    const [playground, setPlayground] = useState('HC-STICKER-3IN-RED');

    // ---- print selection: variantId → quantity ----
    const [qty, setQty] = useState<Record<string, number>>({});
    const [search, setSearch] = useState('');
    const [assigningId, setAssigningId] = useState<string | null>(null);

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: '/admin/labels' });
    }, [status]);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/labels');
            if (!res.ok) {
                setError(res.status === 403 ? 'You don’t have permission to manage labels.' : 'Failed to load variants');
                return;
            }
            const data = await res.json();
            setRows(data.rows || []);
        } catch {
            setError('Failed to load variants');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (session) load(); }, [session, load]);

    // Preselect a variant passed via ?variant= (deep link from inventory / product editor).
    useEffect(() => {
        if (preselectVariant && rows.some(r => r.variantId === preselectVariant)) {
            setQty(q => (q[preselectVariant] ? q : { ...q, [preselectVariant]: 1 }));
        }
    }, [preselectVariant, rows]);

    const assignSku = async (row: VariantRow, desired?: string) => {
        setAssigningId(row.variantId);
        setError(null);
        try {
            const res = await fetch('/api/admin/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: row.productId, variantId: row.variantId, sku: desired }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Could not assign SKU'); return; }
            setRows(prev => prev.map(r => r.variantId === row.variantId ? { ...r, sku: data.sku, scanCode: data.scanCode } : r));
        } catch {
            setError('Could not assign SKU');
        } finally {
            setAssigningId(null);
        }
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r =>
            r.productName.toLowerCase().includes(q) ||
            r.variantName.toLowerCase().includes(q) ||
            (r.sku || '').toLowerCase().includes(q),
        );
    }, [rows, search]);

    // The set of labels to print: each selected variant repeated `qty` times. Variants
    // without a SKU are skipped (you can't encode nothing) — surfaced in the count.
    const printJobs = useMemo(() => {
        const jobs: { sku: string; scanCode?: string; productName: string; variantName: string; size?: string; color?: string }[] = [];
        let missingSku = 0;
        for (const row of rows) {
            const n = qty[row.variantId] || 0;
            if (n <= 0) continue;
            if (!row.sku) { missingSku += n; continue; }
            for (let i = 0; i < n; i++) {
                jobs.push({ sku: row.sku, scanCode: row.scanCode || undefined, productName: row.productName, variantName: row.variantName, size: row.size, color: row.color });
            }
        }
        return { jobs, missingSku };
    }, [rows, qty]);

    const selectedCount = useMemo(() => Object.values(qty).filter(n => n > 0).length, [qty]);
    const perPage = template.cols * template.rows;

    // Every variant that HAS a SKU → the 4×6 scannable test sheet (all barcodes).
    const testSheetItems: TestSheetItem[] = useMemo(
        () => rows.filter(r => r.sku).map(r => ({
            sku: r.sku as string,
            scanCode: r.scanCode || undefined,
            productName: r.productName,
            variantName: [r.variantName, r.size, r.color].filter(Boolean).join(' · '),
        })),
        [rows],
    );

    // Which print layout the browser print dialog should render. We swap this just
    // before calling window.print() so the two print-only blocks never both show.
    const [printMode, setPrintMode] = useState<'labels' | 'testsheet'>('labels');
    const printLabels = () => { setPrintMode('labels'); requestAnimationFrame(() => window.print()); };
    const printTestSheet = () => { setPrintMode('testsheet'); requestAnimationFrame(() => window.print()); };

    const bumpLowStock = () => {
        const next: Record<string, number> = {};
        for (const r of rows) {
            if (r.available !== null && r.available <= 5 && r.sku) next[r.variantId] = 1;
        }
        setQty(next);
    };

    if (status === 'loading' || (session && loading)) {
        return <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke"><div className="text-hackclub-dark font-bold">Loading…</div></div>;
    }
    if (!session) return null;

    return (
        <div className="min-h-screen bg-white text-hackclub-dark print:bg-white"
            style={{ backgroundImage: 'linear-gradient(to right, #e0f2fe 1px, transparent 1px), linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)', backgroundSize: '30px 30px' }}
        >
            {/* ===== SCREEN UI (hidden when printing) ===== */}
            <div className="print:hidden max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">← Back to Dashboard</Link>
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Labels</h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-8">
                        Design Hack&nbsp;Club–styled barcodes, scan-test them live, and print label sheets. Each label encodes a variant&apos;s <span className="font-bold">SKU</span> — the same code you&apos;ll scan to receive stock.
                    </p>

                    {error && (
                        <div className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        {/* ---- Designer controls ---- */}
                        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                            <h2 className="text-2xl font-black mb-1">Designer</h2>
                            <p className="text-sm font-medium text-hackclub-muted mb-4">
                                Code&nbsp;128 barcodes — what the HQ scanner reads instantly.
                            </p>

                            <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Label size</label>
                            <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                                className="w-full rounded-lg border-2 border-hackclub-smoke px-3 py-2 font-medium mb-4 focus:outline-none focus:border-hackclub-blue">
                                {LABEL_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>

                            <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Show on label</label>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {([
                                    ['showLogo', 'Logo'], ['showProductName', 'Product'], ['showVariant', 'Variant'], ['showSku', 'SKU text'],
                                ] as [keyof LabelStyle, string][]).map(([k, lbl]) => (
                                    <button key={k} type="button" onClick={() => setStyle(v => ({ ...v, [k]: !v[k] }))}
                                        className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 transition-colors ${style[k] ? 'bg-hackclub-green text-white border-hackclub-green' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}>
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                            {style.showLogo && (
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="text-xs font-bold text-hackclub-muted">Mark:</span>
                                    {(['bag', 'wordmark'] as const).map(l => (
                                        <button key={l} type="button" onClick={() => setStyle(v => ({ ...v, logo: l }))}
                                            className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${style.logo === l ? 'bg-hackclub-dark text-white border-hackclub-dark' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}>
                                            {l === 'bag' ? 'Bag + “Hack Club Shop”' : 'Full wordmark'}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Accent</label>
                            <div className="flex flex-wrap gap-2">
                                {ACCENTS.map(a => (
                                    <button key={a.value} type="button" onClick={() => setStyle(v => ({ ...v, accent: a.value }))} title={a.name}
                                        className={`w-8 h-8 rounded-full border-2 transition-transform ${style.accent === a.value ? 'scale-110 border-hackclub-dark' : 'border-white hover:scale-105'}`}
                                        style={{ background: a.value }} />
                                ))}
                            </div>
                        </div>

                        {/* ---- Live preview + playground + scan-test ---- */}
                        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                            <h2 className="text-2xl font-black mb-4">Preview &amp; playground</h2>

                            <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Test payload (any string)</label>
                            <input value={playground} onChange={e => setPlayground(e.target.value)}
                                className="w-full rounded-lg border-2 border-hackclub-smoke px-3 py-2 font-mono mb-4 focus:outline-none focus:border-hackclub-blue" />

                            <div className="flex justify-center mb-4 p-4 rounded-xl bg-hackclub-smoke">
                                <div className="shadow-md ring-1 ring-black/5">
                                    <Label
                                        data={{ sku: playground, productName: 'Hack Club Sticker', variantName: '3in · Red' }}
                                        style={style}
                                        widthMm={template.widthMm}
                                        heightMm={template.heightMm}
                                    />
                                </div>
                            </div>

                            <div className="border-t-2 border-hackclub-smoke pt-4">
                                <h3 className="text-sm font-black uppercase text-hackclub-muted mb-2">Scan-test (round-trip)</h3>
                                <ScanTester expected={playground} />
                            </div>
                        </div>
                    </div>

                    {/* ---- Variant picker / SKU manager / print quantities ---- */}
                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden mb-8">
                        <div className="p-4 border-b-2 border-hackclub-smoke flex flex-wrap items-center gap-3 justify-between">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-black">Variants</h2>
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                                    className="rounded-lg border-2 border-hackclub-smoke px-3 py-1.5 text-sm focus:outline-none focus:border-hackclub-blue" />
                            </div>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={bumpLowStock}
                                    className="px-3 py-1.5 rounded-full text-sm font-bold border-2 border-hackclub-orange text-hackclub-orange hover:bg-hackclub-orange hover:text-white transition-colors">
                                    Select all low-stock
                                </button>
                                <button type="button" onClick={() => setQty({})}
                                    className="px-3 py-1.5 rounded-full text-sm font-bold border-2 border-hackclub-smoke text-hackclub-slate hover:border-hackclub-slate transition-colors">
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-hackclub-snow border-b-2 border-hackclub-smoke">
                                    <tr className="text-left text-hackclub-muted font-black uppercase text-xs">
                                        <th className="px-4 py-3">Product / Variant</th>
                                        <th className="px-4 py-3">SKU</th>
                                        <th className="px-4 py-3 text-right">On hand</th>
                                        <th className="px-4 py-3 text-right">Print qty</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.length === 0 ? (
                                        <tr><td colSpan={4} className="px-4 py-10 text-center text-hackclub-muted font-bold">No variants.</td></tr>
                                    ) : filtered.map(row => (
                                        <tr key={row.variantId} className="border-b border-hackclub-smoke last:border-0">
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-hackclub-dark">{row.productName}{row.draft && <span className="ml-2 text-xs font-black text-hackclub-orange">DRAFT</span>}</div>
                                                <div className="text-hackclub-muted">{row.variantName}{row.size ? ` · ${row.size}` : ''}{row.color ? ` · ${row.color}` : ''}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {row.sku ? (
                                                    <span className="font-mono font-bold">{row.sku}</span>
                                                ) : (
                                                    <button type="button" disabled={assigningId === row.variantId} onClick={() => assignSku(row)}
                                                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-hackclub-blue hover:bg-hackclub-cyan disabled:opacity-40"
                                                        title={`Suggested: ${row.suggestedSku}`}>
                                                        {assigningId === row.variantId ? '…' : 'Generate SKU'}
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">{row.stock === null ? '∞' : row.stock}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end">
                                                    <input type="number" min={0} value={qty[row.variantId] ?? ''} placeholder="0"
                                                        disabled={!row.sku}
                                                        onChange={e => { const n = parseInt(e.target.value, 10); setQty(prev => ({ ...prev, [row.variantId]: Number.isNaN(n) ? 0 : Math.max(0, n) })); }}
                                                        className="w-20 rounded-lg border-2 border-hackclub-smoke px-2 py-1 text-right font-mono focus:outline-none focus:border-hackclub-blue disabled:bg-hackclub-smoke disabled:cursor-not-allowed" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ---- Print bar ---- */}
                    <div className="sticky bottom-4 bg-hackclub-dark text-white rounded-2xl shadow-xl p-4 flex flex-wrap items-center justify-between gap-4">
                        <div className="font-bold">
                            {printJobs.jobs.length} label{printJobs.jobs.length === 1 ? '' : 's'}
                            <span className="text-hackclub-muted font-medium"> · {selectedCount} variant{selectedCount === 1 ? '' : 's'} · {Math.ceil(printJobs.jobs.length / perPage) || 0} page{Math.ceil(printJobs.jobs.length / perPage) === 1 ? '' : 's'} of {template.name.split('—')[0].trim()}</span>
                            {printJobs.missingSku > 0 && <span className="ml-2 text-hackclub-orange font-bold">· {printJobs.missingSku} skipped (no SKU)</span>}
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" disabled={testSheetItems.length === 0} onClick={printTestSheet}
                                title="Every SKU as a big, rotated, scannable Code 128 — sized for a 4×6 sheet"
                                className="px-5 py-2.5 rounded-full font-black bg-white/10 hover:bg-white/20 text-white border-2 border-white/20 disabled:opacity-40 transition-colors">
                                4×6 test sheet · {testSheetItems.length} SKU{testSheetItems.length === 1 ? '' : 's'}
                            </button>
                            <button type="button" disabled={printJobs.jobs.length === 0} onClick={printLabels}
                                className="px-6 py-2.5 rounded-full font-black bg-hackclub-green hover:bg-hackclub-cyan text-white disabled:opacity-40 transition-colors">
                                Print labels
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* ===== PRINT LAYOUTS (only one renders, only when printing) ===== */}
            {printMode === 'labels'
                ? <PrintSheet jobs={printJobs.jobs} style={style} templateId={templateId} />
                : <TestSheet items={testSheetItems} />}
        </div>
    );
}

/** The print-only layout: an N-up grid sized in mm, paginated by the browser. */
function PrintSheet({ jobs, style, templateId }: { jobs: { sku: string; productName: string; variantName: string; size?: string; color?: string }[]; style: LabelStyle; templateId: string }) {
    const template = LABEL_TEMPLATES.find(t => t.id === templateId) || LABEL_TEMPLATES[0];
    return (
        <div className="hidden print:block">
            <style>{`
                @page { size: letter; margin: 0; }
                @media print {
                    html, body { background: #fff !important; }
                    .hc-print-grid {
                        display: grid;
                        grid-template-columns: repeat(${template.cols}, ${template.widthMm}mm);
                        column-gap: ${template.gapXMm}mm;
                        row-gap: ${template.gapYMm}mm;
                        padding-top: ${template.pageMarginTopMm}mm;
                        padding-left: ${template.pageMarginLeftMm}mm;
                    }
                    .hc-print-cell { break-inside: avoid; }
                }
            `}</style>
            <div className="hc-print-grid">
                {jobs.map((j, i) => (
                    <div key={i} className="hc-print-cell">
                        <Label data={j} style={style} widthMm={template.widthMm} heightMm={template.heightMm} />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function LabelsPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-hackclub-smoke"><div className="text-hackclub-dark font-bold">Loading…</div></div>}>
            <LabelsDesigner />
        </Suspense>
    );
}
