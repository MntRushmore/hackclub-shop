'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Vendor, Quote, QuotePriceBreak, QuoteStatus, landedUnitCost } from '../../../../types/Sourcing';
import AssetPanel from '../AssetPanel';

interface BreakRow {
    minQty: string;
    unitCost: string;
}

const EMPTY_FORM = {
    vendorId: '',
    itemName: '',
    variantHint: '',
    moq: '',
    leadTimeDays: '',
    setupFee: '',
    shippingEstimate: '',
    validUntil: '',
    notes: '',
};

const STATUS_COLORS: Record<QuoteStatus, string> = {
    open: 'bg-hackclub-green/10 text-hackclub-green',
    accepted: 'bg-hackclub-blue/10 text-hackclub-blue',
    rejected: 'bg-hackclub-red/10 text-hackclub-red',
    expired: 'bg-hackclub-slate/10 text-hackclub-slate',
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

function QuotesAdminInner() {
    const { data: session, status } = useSession();
    const searchParams = useSearchParams();
    const vendorFilter = searchParams.get('vendorId');

    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [accepting, setAccepting] = useState<string | null>(null);
    const [assetsOpen, setAssetsOpen] = useState<Record<string, boolean>>({});

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [breaks, setBreaks] = useState<BreakRow[]>([{ minQty: '1', unitCost: '' }]);
    const [submitting, setSubmitting] = useState(false);

    const [compareQty, setCompareQty] = useState(100);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/sourcing/quotes' });
        }
    }, [status]);

    useEffect(() => {
        if (!session) return;
        (async () => {
            try {
                const [vRes, qRes] = await Promise.all([
                    fetch('/api/admin/sourcing/vendors'),
                    fetch('/api/admin/sourcing/quotes'),
                ]);
                if (vRes.status === 403 || qRes.status === 403) {
                    setAllowed(false);
                    return;
                }
                const vData = await vRes.json();
                const qData = await qRes.json();
                setVendors(vData.vendors || []);
                setQuotes(qData.quotes || []);
            } catch {
                setError('Failed to load sourcing data');
            } finally {
                setLoading(false);
            }
        })();
    }, [session]);

    const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || 'Unknown vendor';

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setBreaks([{ minQty: '1', unitCost: '' }]);
        setEditingId(null);
        setShowForm(false);
    };

    const startEdit = (q: Quote) => {
        setForm({
            vendorId: q.vendorId,
            itemName: q.itemName,
            variantHint: q.variantHint || '',
            moq: q.moq?.toString() || '',
            leadTimeDays: q.leadTimeDays?.toString() || '',
            setupFee: q.setupFee?.toString() || '',
            shippingEstimate: q.shippingEstimate?.toString() || '',
            validUntil: q.validUntil ? q.validUntil.slice(0, 10) : '',
            notes: q.notes || '',
        });
        setBreaks(
            q.priceBreaks.length
                ? q.priceBreaks.map((b) => ({ minQty: String(b.minQty), unitCost: String(b.unitCost) }))
                : [{ minQty: '1', unitCost: '' }],
        );
        setEditingId(q.id);
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        const priceBreaks: QuotePriceBreak[] = breaks
            .map((b) => ({ minQty: Number(b.minQty), unitCost: Number(b.unitCost) }))
            .filter((b) => Number.isFinite(b.minQty) && Number.isFinite(b.unitCost) && b.minQty > 0);

        if (priceBreaks.length === 0) {
            setError('Add at least one price break (quantity + unit cost)');
            setSubmitting(false);
            return;
        }

        const payload = {
            ...form,
            priceBreaks,
            moq: form.moq || undefined,
            leadTimeDays: form.leadTimeDays || undefined,
            setupFee: form.setupFee || undefined,
            shippingEstimate: form.shippingEstimate || undefined,
            validUntil: form.validUntil || undefined,
        };

        try {
            const res = await fetch(
                editingId ? `/api/admin/sourcing/quotes/${editingId}` : '/api/admin/sourcing/quotes',
                {
                    method: editingId ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to save quote');
                setSubmitting(false);
                return;
            }
            const { quote } = await res.json();
            setQuotes((prev) =>
                editingId ? prev.map((q) => (q.id === quote.id ? quote : q)) : [quote, ...prev],
            );
            resetForm();
        } catch {
            setError('Failed to save quote');
        } finally {
            setSubmitting(false);
        }
    };

    const setStatus = async (q: Quote, newStatus: QuoteStatus) => {
        try {
            const res = await fetch(`/api/admin/sourcing/quotes/${q.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                setError('Failed to update status');
                return;
            }
            const { quote } = await res.json();
            setQuotes((prev) => prev.map((x) => (x.id === quote.id ? quote : x)));
        } catch {
            setError('Failed to update status');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this quote?')) return;
        try {
            const res = await fetch(`/api/admin/sourcing/quotes/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError('Failed to delete quote');
                return;
            }
            setQuotes((prev) => prev.filter((q) => q.id !== id));
        } catch {
            setError('Failed to delete quote');
        }
    };

    const acceptQuote = async (q: Quote) => {
        const rejectSiblings = confirm(
            `Accept "${q.itemName}" from ${vendorName(q.vendorId)}?\n\nThis creates a DRAFT product (no prices yet — publish it later in Products).\n\nClick OK to also reject other open quotes for this item, or Cancel to keep them open.`,
        );
        setAccepting(q.id);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/admin/sourcing/quotes/${q.id}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rejectSiblings }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Failed to accept quote');
                return;
            }
            // Refresh quotes so statuses (accepted + any rejected siblings) reflect server state.
            const qRes = await fetch('/api/admin/sourcing/quotes').then((r) => r.json());
            setQuotes(qRes.quotes || []);
            setNotice(
                `Accepted → draft product created${data.rejectedSiblings ? `, ${data.rejectedSiblings} sibling quote(s) rejected` : ''}. Publish it in Products, then start a PO.`,
            );
        } catch {
            setError('Failed to accept quote');
        } finally {
            setAccepting(null);
        }
    };

    // Filter to a vendor if arriving from a vendor card.
    const visibleQuotes = useMemo(
        () => (vendorFilter ? quotes.filter((q) => q.vendorId === vendorFilter) : quotes),
        [quotes, vendorFilter],
    );

    // Group by normalized item name for the comparison view.
    const groups = useMemo(() => {
        const map = new Map<string, Quote[]>();
        for (const q of visibleQuotes) {
            const key = q.itemName.trim().toLowerCase();
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(q);
        }
        return Array.from(map.entries()).map(([key, qs]) => ({
            key,
            label: qs[0].itemName,
            quotes: qs,
        }));
    }, [visibleQuotes]);

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (session && !allowed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Access Denied</h2>
                    <p className="text-hackclub-slate mb-6">You don&apos;t have permission to manage sourcing.</p>
                    <Link href="/admin" className="inline-block w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const inputClass =
        'w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-green text-hackclub-dark font-medium';

    return (
        <div
            className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <Link href="/admin/sourcing" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                                ← Back to Sourcing
                            </Link>
                            <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Quotes</h1>
                            <p className="text-lg text-hackclub-slate font-medium">
                                {vendorFilter ? `Quotes from ${vendorName(vendorFilter)}` : 'Compare vendor pricing at any quantity'}
                            </p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => (showForm ? resetForm() : (setForm({ ...EMPTY_FORM, vendorId: vendorFilter || '' }), setShowForm(true)))}
                            disabled={vendors.length === 0}
                            className="bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50"
                        >
                            {showForm ? 'Cancel' : '+ New Quote'}
                        </motion.button>
                    </div>

                    {vendors.length === 0 && (
                        <div className="mb-6 p-4 bg-hackclub-yellow/10 border-2 border-hackclub-yellow rounded-xl">
                            <p className="text-hackclub-dark font-bold">
                                Add a vendor first —{' '}
                                <Link href="/admin/sourcing/vendors" className="text-hackclub-blue underline">
                                    go to Vendors
                                </Link>
                            </p>
                        </div>
                    )}

                    {vendorFilter && (
                        <Link href="/admin/sourcing/quotes" className="inline-block mb-6 text-sm font-bold text-hackclub-blue hover:underline">
                            ✕ Clear vendor filter
                        </Link>
                    )}

                    {notice && (
                        <div className="mb-6 p-4 bg-hackclub-green/10 border-2 border-hackclub-green rounded-xl flex items-center justify-between gap-4">
                            <p className="text-hackclub-green font-bold">{notice}</p>
                            <Link href="/admin/sourcing/pos" className="font-black text-hackclub-green hover:underline whitespace-nowrap">
                                Go to POs →
                            </Link>
                        </div>
                    )}
                    {error && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    <AnimatePresence>
                        {showForm && (
                            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="mb-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8">
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">{editingId ? 'Edit Quote' : 'New Quote'}</h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Vendor *</label>
                                            <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required>
                                                <option value="">Select vendor…</option>
                                                {vendors.map((v) => (
                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Item name *</label>
                                            <input className={inputClass} placeholder="e.g. 3in vinyl sticker" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} required />
                                        </div>
                                    </div>

                                    <input className={inputClass} placeholder="Variant hint (size / color) — optional" value={form.variantHint} onChange={(e) => setForm({ ...form, variantHint: e.target.value })} />

                                    {/* Price breaks */}
                                    <div>
                                        <label className="block text-sm font-bold text-hackclub-slate mb-2">Quantity price breaks *</label>
                                        <div className="space-y-2">
                                            {breaks.map((b, i) => (
                                                <div key={i} className="flex gap-2 items-center">
                                                    <input className={inputClass} type="number" min="1" placeholder="Min qty" value={b.minQty} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} />
                                                    <span className="text-hackclub-slate font-bold">@</span>
                                                    <input className={inputClass} type="number" min="0" step="0.01" placeholder="$ / unit" value={b.unitCost} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} />
                                                    {breaks.length > 1 && (
                                                        <button type="button" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} className="text-hackclub-red font-black px-2" aria-label="Remove price break">
                                                            ✕
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <button type="button" onClick={() => setBreaks([...breaks, { minQty: '', unitCost: '' }])} className="mt-2 text-sm font-bold text-hackclub-green hover:underline">
                                            + Add price break
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">MOQ</label>
                                            <input className={inputClass} type="number" min="0" value={form.moq} onChange={(e) => setForm({ ...form, moq: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Lead (days)</label>
                                            <input className={inputClass} type="number" min="0" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Setup fee ($)</label>
                                            <input className={inputClass} type="number" min="0" step="0.01" value={form.setupFee} onChange={(e) => setForm({ ...form, setupFee: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Shipping est. ($)</label>
                                            <input className={inputClass} type="number" min="0" step="0.01" value={form.shippingEstimate} onChange={(e) => setForm({ ...form, shippingEstimate: e.target.value })} />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Valid until</label>
                                            <input className={inputClass} type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                                        </div>
                                    </div>

                                    <textarea className={inputClass} rows={2} placeholder="Notes — optional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

                                    <button type="submit" disabled={submitting} className="bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50">
                                        {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Create Quote'}
                                    </button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Compare-at-quantity control */}
                    {groups.length > 0 && (
                        <div className="mb-6 flex items-center gap-3 flex-wrap">
                            <span className="font-bold text-hackclub-slate">Compare landed cost at quantity:</span>
                            <input
                                type="number"
                                min="1"
                                value={compareQty}
                                onChange={(e) => setCompareQty(Math.max(1, Number(e.target.value) || 1))}
                                className="w-28 px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-green text-hackclub-dark font-bold"
                            />
                            <span className="text-sm text-hackclub-slate">landed = tier price + setup/qty + shipping/qty</span>
                        </div>
                    )}

                    {groups.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-hackclub-smoke">
                            <p className="text-hackclub-slate font-bold text-lg mb-1">No quotes yet</p>
                            <p className="text-hackclub-slate text-sm">Log a quote to start comparing vendors.</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {groups.map((group) => {
                                // Cheapest landed cost in this group at the compare quantity.
                                const landed = group.quotes.map((q) => ({ q, cost: landedUnitCost(q, compareQty) }));
                                const cheapest = landed
                                    .filter((x) => x.cost !== null)
                                    .reduce<number | null>((min, x) => (min === null || (x.cost as number) < min ? (x.cost as number) : min), null);

                                return (
                                    <div key={group.key} className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden">
                                        <div className="px-6 py-4 border-b-2 border-hackclub-smoke flex items-center justify-between">
                                            <h3 className="text-xl font-black text-hackclub-dark">{group.label}</h3>
                                            <span className="text-sm font-bold text-hackclub-slate">{group.quotes.length} quote{group.quotes.length === 1 ? '' : 's'}</span>
                                        </div>
                                        <div className="divide-y divide-hackclub-smoke">
                                            {landed.map(({ q, cost }) => {
                                                const isCheapest = cost !== null && cost === cheapest && group.quotes.length > 1;
                                                return (
                                                  <div key={q.id} className={isCheapest ? 'bg-hackclub-green/5' : ''}>
                                                    <div className="px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                                                        <div className="min-w-[140px]">
                                                            <div className="font-black text-hackclub-dark flex items-center gap-2">
                                                                {vendorName(q.vendorId)}
                                                                {isCheapest && <span className="text-xs font-black bg-hackclub-green text-white px-2 py-0.5 rounded-full">CHEAPEST</span>}
                                                            </div>
                                                            <span className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>{q.status}</span>
                                                        </div>
                                                        <div className="min-w-[120px]">
                                                            <div className="text-2xl font-black text-hackclub-dark">{cost !== null ? fmt(cost) : '—'}</div>
                                                            <div className="text-xs text-hackclub-slate">landed / unit @ {compareQty}</div>
                                                        </div>
                                                        <div className="text-sm text-hackclub-slate space-y-0.5">
                                                            <div>Breaks: {q.priceBreaks.map((b) => `${b.minQty}+ @ ${fmt(b.unitCost)}`).join(' · ')}</div>
                                                            <div className="flex flex-wrap gap-x-4">
                                                                {q.moq ? <span>MOQ {q.moq}</span> : null}
                                                                {q.leadTimeDays ? <span>{q.leadTimeDays}d lead</span> : null}
                                                                {q.setupFee ? <span>{fmt(q.setupFee)} setup</span> : null}
                                                                {q.validUntil ? <span>valid → {q.validUntil.slice(0, 10)}</span> : null}
                                                            </div>
                                                        </div>
                                                        <div className="ml-auto flex items-center gap-2 text-sm">
                                                            {q.status === 'accepted' && q.productId ? (
                                                                <Link href={`/admin/sourcing/pos?quoteId=${q.id}`} className="font-black text-hackclub-blue hover:underline">
                                                                    Start PO →
                                                                </Link>
                                                            ) : (
                                                                <button
                                                                    onClick={() => acceptQuote(q)}
                                                                    disabled={accepting === q.id}
                                                                    className="font-bold text-hackclub-blue hover:underline disabled:opacity-50"
                                                                >
                                                                    {accepting === q.id ? 'Accepting…' : 'Accept & create product'}
                                                                </button>
                                                            )}
                                                            {q.status !== 'rejected' && q.status !== 'accepted' && (
                                                                <button onClick={() => setStatus(q, 'rejected')} className="font-bold text-hackclub-slate hover:text-hackclub-dark">Reject</button>
                                                            )}
                                                            <button onClick={() => setAssetsOpen((p) => ({ ...p, [q.id]: !p[q.id] }))} className="font-bold text-hackclub-slate hover:text-hackclub-dark">
                                                                {assetsOpen[q.id] ? 'Hide assets' : 'Assets'}
                                                            </button>
                                                            <button onClick={() => startEdit(q)} className="font-bold text-hackclub-slate hover:text-hackclub-dark">Edit</button>
                                                            <button onClick={() => handleDelete(q.id)} className="font-bold text-hackclub-red hover:underline">Delete</button>
                                                        </div>
                                                    </div>
                                                    {assetsOpen[q.id] && (
                                                        <div className="px-6 pb-4">
                                                            <AssetPanel quoteId={q.id} title="Quote assets (mockups, proofs, print files)" />
                                                        </div>
                                                    )}
                                                  </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}

export default function QuotesAdmin() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-hackclub-smoke"><div className="text-hackclub-dark font-bold">Loading...</div></div>}>
            <QuotesAdminInner />
        </Suspense>
    );
}
