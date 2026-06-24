'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Vendor, Quote, PurchaseOrder, POLine, PurchaseOrderStatus, landedUnitCost } from '../../../../types/Sourcing';
import AssetPanel from '../AssetPanel';

const STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
    draft: 'bg-hackclub-slate/10 text-hackclub-slate',
    issued: 'bg-hackclub-blue/10 text-hackclub-blue',
    in_transit: 'bg-hackclub-orange/10 text-hackclub-orange',
    received: 'bg-hackclub-green/10 text-hackclub-green',
    cancelled: 'bg-hackclub-red/10 text-hackclub-red',
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

function poTotal(po: PurchaseOrder): number {
    const lines = po.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    return lines + (po.setupFee || 0) + (po.shippingCost || 0);
}

interface LineForm {
    productId: string;
    variantId: string;
    description: string;
    quantity: string;
    unitCost: string;
}

function POAdminInner() {
    const { data: session, status } = useSession();
    const searchParams = useSearchParams();
    const prefillQuoteId = searchParams.get('quoteId');

    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(true);
    const [canFinance, setCanFinance] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [assetsOpen, setAssetsOpen] = useState<Record<string, boolean>>({});

    const [showForm, setShowForm] = useState(false);
    const [formVendorId, setFormVendorId] = useState('');
    const [formQuoteId, setFormQuoteId] = useState('');
    const [formSetupFee, setFormSetupFee] = useState('');
    const [formShipping, setFormShipping] = useState('');
    const [formExpected, setFormExpected] = useState('');
    const [lines, setLines] = useState<LineForm[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/sourcing/pos' });
        }
    }, [status]);

    useEffect(() => {
        if (!session) return;
        (async () => {
            try {
                const me = await fetch('/api/admin/me').then((r) => r.json());
                if (!me?.permissions?.canManageSourcing) {
                    setAllowed(false);
                    return;
                }
                setCanFinance(Boolean(me?.permissions?.canManageFinance));
                const [v, q, p] = await Promise.all([
                    fetch('/api/admin/sourcing/vendors').then((r) => r.json()),
                    fetch('/api/admin/sourcing/quotes').then((r) => r.json()),
                    fetch('/api/admin/sourcing/pos').then((r) => r.json()),
                ]);
                setVendors(v.vendors || []);
                setQuotes(q.quotes || []);
                setPos(p.pos || []);
            } catch {
                setError('Failed to load purchase orders');
            } finally {
                setLoading(false);
            }
        })();
    }, [session]);

    const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || 'Unknown vendor';

    // Prefill a PO from an accepted quote arriving via ?quoteId=.
    useEffect(() => {
        if (!prefillQuoteId || quotes.length === 0 || showForm) return;
        const q = quotes.find((x) => x.id === prefillQuoteId);
        if (!q || !q.productId) return;
        const qty = q.moq || (q.priceBreaks.length ? Math.min(...q.priceBreaks.map((b) => b.minQty)) : 1);
        const cost = landedUnitCost(q, qty) ?? (q.priceBreaks[0]?.unitCost || 0);
        setFormVendorId(q.vendorId);
        setFormQuoteId(q.id);
        setFormSetupFee(q.setupFee?.toString() || '');
        setFormShipping(q.shippingEstimate?.toString() || '');
        setLines([
            {
                productId: q.productId,
                // The accept flow seeds a single variant; the admin confirms the id.
                variantId: '',
                description: `${q.itemName}${q.variantHint ? ` — ${q.variantHint}` : ''}`,
                quantity: String(qty),
                unitCost: cost.toFixed(2),
            },
        ]);
        setShowForm(true);
    }, [prefillQuoteId, quotes, showForm]);

    const resetForm = () => {
        setFormVendorId('');
        setFormQuoteId('');
        setFormSetupFee('');
        setFormShipping('');
        setFormExpected('');
        setLines([]);
        setShowForm(false);
    };

    const acceptedQuotesForVendor = useMemo(
        () => quotes.filter((q) => q.status === 'accepted' && (!formVendorId || q.vendorId === formVendorId)),
        [quotes, formVendorId],
    );

    const submit = async (issue: boolean) => {
        setSubmitting(true);
        setError(null);
        const cleanLines: POLine[] = lines
            .map((l) => ({
                productId: l.productId.trim(),
                variantId: l.variantId.trim(),
                description: l.description.trim(),
                quantity: Math.floor(Number(l.quantity)),
                unitCost: Number(l.unitCost),
            }))
            .filter((l) => l.productId && l.variantId && l.quantity > 0 && Number.isFinite(l.unitCost));

        if (!formVendorId || cleanLines.length === 0) {
            setError('Pick a vendor and add at least one complete line (product, variant id, qty, cost).');
            setSubmitting(false);
            return;
        }

        try {
            const res = await fetch('/api/admin/sourcing/pos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorId: formVendorId,
                    quoteId: formQuoteId || undefined,
                    lines: cleanLines,
                    setupFee: formSetupFee || undefined,
                    shippingCost: formShipping || undefined,
                    expectedDate: formExpected || undefined,
                    status: issue ? 'issued' : 'draft',
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to create PO');
                setSubmitting(false);
                return;
            }
            const { po } = await res.json();
            setPos((prev) => [po, ...prev]);
            resetForm();
            setNotice(`PO ${po.id} created`);
        } catch {
            setError('Failed to create PO');
        } finally {
            setSubmitting(false);
        }
    };

    const changeStatus = async (po: PurchaseOrder, newStatus: PurchaseOrderStatus) => {
        setError(null);
        try {
            const res = await fetch(`/api/admin/sourcing/pos/${po.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to update PO');
                return;
            }
            const { po: updated } = await res.json();
            setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        } catch {
            setError('Failed to update PO');
        }
    };

    const receive = async (po: PurchaseOrder) => {
        if (!confirm(`Receive PO ${po.id}? This posts ${po.lines.length} line(s) to the costing ledger (stock + weighted-avg cost). This cannot be undone.`)) return;
        setError(null);
        try {
            const res = await fetch(`/api/admin/sourcing/pos/${po.id}/receive`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Failed to receive PO');
                // The PO may have partially advanced — refresh it if returned.
                return;
            }
            setPos((prev) => prev.map((p) => (p.id === data.po.id ? data.po : p)));
            setNotice(
                data.alreadyReceived
                    ? `PO ${po.id} was already received`
                    : `Received PO ${po.id} — ${data.receiptIds.length} line(s) posted to the ledger`,
            );
        } catch {
            setError('Failed to receive PO');
        }
    };

    const deletePO = async (po: PurchaseOrder) => {
        if (!confirm(`Delete PO ${po.id}?`)) return;
        try {
            const res = await fetch(`/api/admin/sourcing/pos/${po.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to delete PO');
                return;
            }
            setPos((prev) => prev.filter((p) => p.id !== po.id));
        } catch {
            setError('Failed to delete PO');
        }
    };

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
        'w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-medium';

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
                            <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Purchase Orders</h1>
                            <p className="text-lg text-hackclub-slate font-medium">
                                Order from vendors — receiving posts straight to inventory + cost basis.
                            </p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => (showForm ? resetForm() : (setLines([{ productId: '', variantId: '', description: '', quantity: '', unitCost: '' }]), setShowForm(true)))}
                            disabled={vendors.length === 0}
                            className="bg-hackclub-blue hover:bg-hackclub-blue/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50"
                        >
                            {showForm ? 'Cancel' : '+ New PO'}
                        </motion.button>
                    </div>

                    {!canFinance && (
                        <div className="mb-6 p-4 bg-hackclub-yellow/10 border-2 border-hackclub-yellow rounded-xl">
                            <p className="text-hackclub-dark font-bold">
                                You can create and track POs, but <span className="underline">receiving</span> requires finance permission (it moves cost basis).
                            </p>
                        </div>
                    )}

                    {notice && (
                        <div className="mb-6 p-4 bg-hackclub-green/10 border-2 border-hackclub-green rounded-xl">
                            <p className="text-hackclub-green font-bold">{notice}</p>
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
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">New Purchase Order</h2>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Vendor *</label>
                                            <select className={inputClass} value={formVendorId} onChange={(e) => setFormVendorId(e.target.value)}>
                                                <option value="">Select vendor…</option>
                                                {vendors.map((v) => (
                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">From accepted quote (optional)</label>
                                            <select className={inputClass} value={formQuoteId} onChange={(e) => setFormQuoteId(e.target.value)}>
                                                <option value="">None</option>
                                                {acceptedQuotesForVendor.map((q) => (
                                                    <option key={q.id} value={q.id}>{q.itemName}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-hackclub-slate mb-2">Lines *</label>
                                        <p className="text-xs text-hackclub-slate mb-2">
                                            Product id + variant id come from the product the quote created (Products admin shows them). Qty × unit cost is what posts to the ledger on receive.
                                        </p>
                                        <div className="space-y-3">
                                            {lines.map((l, i) => (
                                                <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center border-2 border-hackclub-smoke rounded-lg p-3">
                                                    <input className={`${inputClass} sm:col-span-3`} placeholder="product id" value={l.productId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))} />
                                                    <input className={`${inputClass} sm:col-span-3`} placeholder="variant id" value={l.variantId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, variantId: e.target.value } : x)))} />
                                                    <input className={`${inputClass} sm:col-span-3`} placeholder="description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                                                    <input className={`${inputClass} sm:col-span-1`} type="number" min="1" placeholder="qty" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                                                    <input className={`${inputClass} sm:col-span-1`} type="number" min="0" step="0.01" placeholder="$/unit" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} />
                                                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-hackclub-red font-black sm:col-span-1" aria-label="Remove line">✕</button>
                                                </div>
                                            ))}
                                        </div>
                                        <button type="button" onClick={() => setLines([...lines, { productId: '', variantId: '', description: '', quantity: '', unitCost: '' }])} className="mt-2 text-sm font-bold text-hackclub-blue hover:underline">
                                            + Add line
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Setup fee ($)</label>
                                            <input className={inputClass} type="number" min="0" step="0.01" value={formSetupFee} onChange={(e) => setFormSetupFee(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Shipping ($)</label>
                                            <input className={inputClass} type="number" min="0" step="0.01" value={formShipping} onChange={(e) => setFormShipping(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Expected date</label>
                                            <input className={inputClass} type="date" value={formExpected} onChange={(e) => setFormExpected(e.target.value)} />
                                        </div>
                                    </div>

                                    <div className="flex gap-3">
                                        <button onClick={() => submit(false)} disabled={submitting} className="bg-hackclub-slate hover:bg-hackclub-slate/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50">
                                            {submitting ? 'Saving…' : 'Save as Draft'}
                                        </button>
                                        <button onClick={() => submit(true)} disabled={submitting} className="bg-hackclub-blue hover:bg-hackclub-blue/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50">
                                            {submitting ? 'Saving…' : 'Create & Issue'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {pos.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-hackclub-smoke">
                            <p className="text-hackclub-slate font-bold text-lg mb-1">No purchase orders yet</p>
                            <p className="text-hackclub-slate text-sm">Accept a quote, then start a PO from it — or create one here.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {pos.map((po) => (
                                <div key={po.id} className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${STATUS_COLORS[po.status]}`}>{po.status.replace('_', ' ')}</span>
                                        <span className="font-black text-hackclub-dark">{vendorName(po.vendorId)}</span>
                                        <span className="text-hackclub-slate text-sm font-mono">{po.id}</span>
                                        <span className="ml-auto text-2xl font-black text-hackclub-dark">{fmt(poTotal(po))}</span>
                                    </div>
                                    <div className="divide-y divide-hackclub-smoke border-y border-hackclub-smoke mb-3">
                                        {po.lines.map((l, i) => (
                                            <div key={i} className="py-2 flex flex-wrap gap-x-4 text-sm">
                                                <span className="font-bold text-hackclub-dark">{l.quantity}×</span>
                                                <span className="text-hackclub-dark">{l.description || l.variantId}</span>
                                                <span className="text-hackclub-slate">@ {fmt(l.unitCost)}</span>
                                                <span className="ml-auto font-bold text-hackclub-dark">{fmt(l.quantity * l.unitCost)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-sm text-hackclub-slate mb-3">
                                        {po.setupFee ? <span>setup {fmt(po.setupFee)}</span> : null}
                                        {po.shippingCost ? <span>shipping {fmt(po.shippingCost)}</span> : null}
                                        {po.expectedDate ? <span>expected {po.expectedDate.slice(0, 10)}</span> : null}
                                        {po.receivedReceiptIds && po.receivedReceiptIds.length > 0 ? (
                                            <span className="text-hackclub-green font-bold">{po.receivedReceiptIds.length} receipt(s) in ledger</span>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        {po.status === 'draft' && (
                                            <button onClick={() => changeStatus(po, 'issued')} className="font-bold text-hackclub-blue hover:underline">Issue</button>
                                        )}
                                        {(po.status === 'issued') && (
                                            <button onClick={() => changeStatus(po, 'in_transit')} className="font-bold text-hackclub-orange hover:underline">Mark in transit</button>
                                        )}
                                        {(po.status === 'issued' || po.status === 'in_transit') && (
                                            <button
                                                onClick={() => receive(po)}
                                                disabled={!canFinance}
                                                title={canFinance ? '' : 'Requires finance permission'}
                                                className="font-bold text-hackclub-green hover:underline disabled:opacity-40 disabled:no-underline"
                                            >
                                                Receive →
                                            </button>
                                        )}
                                        {(po.status === 'draft' || po.status === 'issued' || po.status === 'in_transit') && (
                                            <button onClick={() => changeStatus(po, 'cancelled')} className="font-bold text-hackclub-slate hover:text-hackclub-dark">Cancel</button>
                                        )}
                                        <button
                                            onClick={() => setAssetsOpen((p) => ({ ...p, [po.id]: !p[po.id] }))}
                                            className={`font-bold text-hackclub-slate hover:text-hackclub-dark ${po.status === 'received' ? 'ml-auto' : ''}`}
                                        >
                                            {assetsOpen[po.id] ? 'Hide assets' : 'Assets'}
                                        </button>
                                        {po.status !== 'received' && (
                                            <button onClick={() => deletePO(po)} className="font-bold text-hackclub-red hover:underline ml-auto">Delete</button>
                                        )}
                                    </div>
                                    {assetsOpen[po.id] && (
                                        <AssetPanel poId={po.id} title="PO assets (proofs, print files)" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}

export default function POAdmin() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-hackclub-smoke"><div className="text-hackclub-dark font-bold">Loading...</div></div>}>
            <POAdminInner />
        </Suspense>
    );
}
