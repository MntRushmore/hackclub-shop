'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useScanInput } from './useScanInput';

type Mode = 'receive' | 'lookup' | 'count';

interface Resolved {
    sku: string;
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    size?: string;
    color?: string;
    onHand: number | null;
    available: number | null;
    currentUnitCost: number | null;
    lastReceiptUnitCost: number | null;
    unitCostPrefill: number | null;
    openPO: { poId: string; quantity: number; unitCost: number; description: string } | null;
}

interface FeedItem {
    id: string;
    kind: 'received' | 'counted' | 'looked-up' | 'error';
    sku: string;
    label: string;
    detail: string;
}

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '—');

// A short tick/buzz via WebAudio — eyes-on-the-box feedback. Created lazily on first use.
function useBeep() {
    const ctxRef = useRef<AudioContext | null>(null);
    return useCallback((ok: boolean) => {
        try {
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!ctxRef.current) ctxRef.current = new Ctor();
            const ctx = ctxRef.current;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = ok ? 880 : 220;
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.25));
            osc.start(); osc.stop(ctx.currentTime + (ok ? 0.12 : 0.25));
        } catch { /* audio optional */ }
    }, []);
}

export default function ReceivingScan() {
    const { data: session, status } = useSession();
    const [mode, setMode] = useState<Mode>('receive');
    const [resolved, setResolved] = useState<Resolved | null>(null);
    const [qty, setQty] = useState('1');
    const [cost, setCost] = useState('');
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<'ok' | 'err' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const seqRef = useRef(0);
    const beep = useBeep();

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: '/admin/receiving' });
    }, [status]);

    const doFlash = useCallback((kind: 'ok' | 'err') => {
        beep(kind === 'ok');
        setFlash(kind);
        window.setTimeout(() => setFlash(null), 350);
    }, [beep]);

    const pushFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
        seqRef.current += 1;
        setFeed(prev => [{ ...item, id: `f${seqRef.current}` }, ...prev].slice(0, 30));
    }, []);

    // Count mode posts the SET stock directly on scan-confirm; receive needs qty/cost first.
    const onScan = useCallback(async (raw: string) => {
        setError(null);
        const sku = raw.trim();
        if (!sku || busy) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/receiving/resolve?sku=${encodeURIComponent(sku)}`);
            const data = await res.json();
            if (!res.ok) {
                doFlash('err');
                pushFeed({ kind: 'error', sku, label: 'Unknown label', detail: data.message || 'No match' });
                setResolved(null);
                return;
            }
            doFlash('ok');
            const r = data as Resolved;
            setResolved(r);
            // Prefill the entry fields.
            setQty(r.openPO ? String(r.openPO.quantity) : '1');
            setCost(r.unitCostPrefill != null ? String(r.unitCostPrefill) : '');
            if (mode === 'lookup') {
                pushFeed({ kind: 'looked-up', sku: r.sku, label: `${r.productName} · ${r.variantName}`, detail: `on hand ${r.onHand ?? '∞'}` });
            }
        } catch {
            doFlash('err');
            setError('Lookup failed — check your connection.');
        } finally {
            setBusy(false);
        }
    }, [busy, mode, doFlash, pushFeed]);

    const { inputRef, onKeyDown, videoRef, cameraOn, setCameraOn, cameraError } = useScanInput(onScan);

    const confirmReceive = async () => {
        if (!resolved) return;
        const q = parseInt(qty, 10);
        const c = parseFloat(cost);
        if (Number.isNaN(q) || q <= 0) { setError('Quantity must be a positive whole number.'); return; }
        if (Number.isNaN(c) || c < 0) { setError('Unit cost must be zero or more.'); return; }
        setBusy(true); setError(null);
        try {
            // Client-supplied receipt id so a double-tap of Confirm is idempotent (free receive).
            seqRef.current += 1;
            const receiptId = `scan_${resolved.variantId}_${seqRef.current}`;
            const res = await fetch('/api/admin/receiving/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productId: resolved.productId,
                    variantId: resolved.variantId,
                    quantity: q,
                    unitCost: c,
                    poId: resolved.openPO?.poId,
                    receiptId,
                }),
            });
            const data = await res.json();
            if (!res.ok) { doFlash('err'); setError(data.error || 'Receive failed'); return; }
            doFlash('ok');
            const poNote = data.mode === 'po'
                ? (data.poCompleted ? ` · PO ${data.poId} fully received ✓` : ` · against PO ${data.poId}`)
                : '';
            pushFeed({
                kind: 'received',
                sku: resolved.sku,
                label: `${resolved.productName} · ${resolved.variantName}`,
                detail: `+${q} @ ${money(c)}${data.duplicate ? ' (already counted — no-op)' : ''}${poNote}`,
            });
            setResolved(null); setQty('1'); setCost('');
            inputRef.current?.focus();
        } catch {
            doFlash('err'); setError('Receive failed — check your connection.');
        } finally {
            setBusy(false);
        }
    };

    const confirmCount = async () => {
        if (!resolved) return;
        const q = qty.trim();
        const count = q === '' ? null : parseInt(q, 10);
        if (count !== null && (Number.isNaN(count) || count < 0)) { setError('Count must be a non-negative number (or blank for unlimited).'); return; }
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/admin/receiving/count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: resolved.productId, variantId: resolved.variantId, count }),
            });
            const data = await res.json();
            if (!res.ok) { doFlash('err'); setError(data.error || 'Count failed'); return; }
            doFlash('ok');
            pushFeed({
                kind: 'counted',
                sku: resolved.sku,
                label: `${resolved.productName} · ${resolved.variantName}`,
                detail: `set to ${data.count ?? '∞'} (was ${resolved.onHand ?? '∞'})`,
            });
            setResolved(null); setQty('1'); setCost('');
            inputRef.current?.focus();
        } catch {
            doFlash('err'); setError('Count failed — check your connection.');
        } finally {
            setBusy(false);
        }
    };

    if (status === 'loading') {
        return <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke"><div className="text-hackclub-dark font-bold">Loading…</div></div>;
    }
    if (!session) return null;

    const MODES: { id: Mode; label: string; hint: string }[] = [
        { id: 'receive', label: 'Receive', hint: 'Add stock + cost (purchase)' },
        { id: 'lookup', label: 'Look up', hint: 'What is this & how many?' },
        { id: 'count', label: 'Cycle count', hint: 'Correct the count (no cost)' },
    ];

    return (
        <div className="min-h-screen bg-white text-hackclub-dark"
            style={{ backgroundImage: 'linear-gradient(to right, #e0f2fe 1px, transparent 1px), linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)', backgroundSize: '30px 30px' }}
        >
            {/* Scan flash overlay */}
            <AnimatePresence>
                {flash && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 0.18 }} exit={{ opacity: 0 }}
                        className={`fixed inset-0 z-50 pointer-events-none ${flash === 'ok' ? 'bg-hackclub-green' : 'bg-hackclub-red'}`}
                    />
                )}
            </AnimatePresence>

            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">← Back to Dashboard</Link>
                <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Scan to receive</h1>
                <p className="text-lg text-hackclub-slate font-medium mb-6">
                    Scan a label with the HQ scanner. Stock + weighted-avg cost update through the receiving ledger; scanning a box reconciles against its open PO. Manage labels in <Link href="/admin/labels" className="text-hackclub-purple hover:underline font-bold">Labels</Link>.
                </p>

                {/* Mode switch */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {MODES.map(m => (
                        <button key={m.id} type="button" onClick={() => { setMode(m.id); setResolved(null); setError(null); }}
                            className={`px-4 py-2 rounded-full text-sm font-bold border-2 transition-colors ${mode === m.id ? 'bg-hackclub-dark text-white border-hackclub-dark' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}
                            title={m.hint}>
                            {m.label}
                        </button>
                    ))}
                    <span className="self-center text-sm text-hackclub-muted font-medium ml-1">{MODES.find(m => m.id === mode)?.hint}</span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Scan + entry */}
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="w-2.5 h-2.5 rounded-full bg-hackclub-green animate-pulse" />
                                <span className="text-sm font-bold text-hackclub-slate">Scanner ready</span>
                                <button type="button" onClick={() => setCameraOn(v => !v)}
                                    className={`ml-auto px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${cameraOn ? 'bg-hackclub-red text-white border-hackclub-red' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}>
                                    {cameraOn ? 'Stop camera' : 'Use camera'}
                                </button>
                            </div>
                            <input
                                ref={inputRef}
                                onKeyDown={onKeyDown}
                                inputMode="none"
                                aria-label="Scanner input"
                                placeholder="Scan a label, or type a SKU + Enter…"
                                className="w-full rounded-lg border-2 border-dashed border-hackclub-smoke bg-hackclub-smoke px-3 py-3 font-mono text-base focus:outline-none focus:border-hackclub-blue"
                            />
                            {cameraOn && (
                                <div className="mt-3 rounded-xl overflow-hidden border-2 border-hackclub-smoke bg-black">
                                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                    <video ref={videoRef} className="w-full max-h-64 object-contain" />
                                </div>
                            )}
                            {cameraError && <p className="mt-2 text-sm font-bold text-hackclub-red">{cameraError}</p>}
                        </div>

                        {error && (
                            <div className="p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                                <p className="text-hackclub-red font-bold">{error}</p>
                            </div>
                        )}

                        {/* Resolved card */}
                        {resolved && mode !== 'lookup' && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-blue p-6">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div>
                                        <div className="font-black text-lg text-hackclub-dark">{resolved.productName}</div>
                                        <div className="text-hackclub-slate font-medium">{resolved.variantName}{resolved.size ? ` · ${resolved.size}` : ''}{resolved.color ? ` · ${resolved.color}` : ''}</div>
                                        <div className="font-mono text-sm text-hackclub-purple font-bold mt-1">{resolved.sku}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-black uppercase text-hackclub-muted">On hand</div>
                                        <div className="text-2xl font-black text-hackclub-dark">{resolved.onHand ?? '∞'}</div>
                                    </div>
                                </div>

                                {resolved.openPO && mode === 'receive' && (
                                    <div className="mb-3 p-2 rounded-lg bg-hackclub-blue/10 text-sm font-bold text-hackclub-blue">
                                        Open PO {resolved.openPO.poId} · {resolved.openPO.quantity}× @ {money(resolved.openPO.unitCost)} — receiving reconciles to it.
                                    </div>
                                )}

                                <div className="flex flex-wrap items-end gap-3">
                                    <div>
                                        <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">{mode === 'count' ? 'Counted qty' : 'Quantity'}</label>
                                        <input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)}
                                            className="w-28 rounded-lg border-2 border-hackclub-smoke px-3 py-2 text-right font-mono focus:outline-none focus:border-hackclub-blue" />
                                    </div>
                                    {mode === 'receive' && (
                                        <div>
                                            <label className="block text-xs font-black uppercase text-hackclub-muted mb-1">Unit cost ($)</label>
                                            <input type="number" step="0.01" min={0} value={cost} onChange={e => setCost(e.target.value)}
                                                className="w-32 rounded-lg border-2 border-hackclub-smoke px-3 py-2 text-right font-mono focus:outline-none focus:border-hackclub-blue" />
                                        </div>
                                    )}
                                    <button type="button" disabled={busy} onClick={mode === 'count' ? confirmCount : confirmReceive}
                                        className={`ml-auto px-6 py-2.5 rounded-full font-black text-white disabled:opacity-40 transition-colors ${mode === 'count' ? 'bg-hackclub-orange hover:bg-hackclub-red' : 'bg-hackclub-green hover:bg-hackclub-cyan'}`}>
                                        {busy ? '…' : mode === 'count' ? 'Set count' : 'Receive'}
                                    </button>
                                </div>
                                {mode === 'count' && (
                                    <p className="mt-2 text-xs text-hackclub-muted font-medium">Cycle count SETS the on-hand number — it does not change cost basis. Blank = unlimited.</p>
                                )}
                            </motion.div>
                        )}

                        {resolved && mode === 'lookup' && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                                <div className="font-black text-lg text-hackclub-dark">{resolved.productName}</div>
                                <div className="text-hackclub-slate font-medium">{resolved.variantName}{resolved.size ? ` · ${resolved.size}` : ''}{resolved.color ? ` · ${resolved.color}` : ''}</div>
                                <div className="font-mono text-sm text-hackclub-purple font-bold mt-1 mb-3">{resolved.sku}</div>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                    <div><div className="text-xs font-black uppercase text-hackclub-muted">On hand</div><div className="text-2xl font-black">{resolved.onHand ?? '∞'}</div></div>
                                    <div><div className="text-xs font-black uppercase text-hackclub-muted">Available</div><div className="text-2xl font-black">{resolved.available ?? '∞'}</div></div>
                                    <div><div className="text-xs font-black uppercase text-hackclub-muted">Avg cost</div><div className="text-2xl font-black">{money(resolved.currentUnitCost)}</div></div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <Link href={`/admin/labels?variant=${encodeURIComponent(resolved.variantId)}`} className="px-3 py-1.5 rounded-lg text-xs font-bold text-hackclub-purple border-2 border-hackclub-purple/30 hover:bg-hackclub-purple hover:text-white transition-colors">Labels</Link>
                                    <Link href="https://dashboard.stripe.com/products" className="px-3 py-1.5 rounded-lg text-xs font-bold text-hackclub-blue border-2 border-hackclub-blue/30 hover:bg-hackclub-blue hover:text-white transition-colors">Inventory</Link>
                                </div>
                            </motion.div>
                        )}
                    </div>

                    {/* Session feed */}
                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
                        <h2 className="text-xl font-black mb-1">This session</h2>
                        <p className="text-sm text-hackclub-muted font-medium mb-4">{feed.filter(f => f.kind !== 'error' && f.kind !== 'looked-up').length} action(s). Receipts are in the ledger — undo via Finance, not here.</p>
                        {feed.length === 0 ? (
                            <p className="text-hackclub-muted font-bold py-8 text-center">Nothing scanned yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {feed.map(f => (
                                    <div key={f.id} className={`p-3 rounded-xl border-2 ${
                                        f.kind === 'error' ? 'border-hackclub-red/40 bg-hackclub-red/5'
                                        : f.kind === 'counted' ? 'border-hackclub-orange/40 bg-hackclub-orange/5'
                                        : f.kind === 'looked-up' ? 'border-hackclub-smoke bg-hackclub-snow'
                                        : 'border-hackclub-green/40 bg-hackclub-green/5'}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold text-sm text-hackclub-dark truncate">{f.label}</span>
                                            <span className="font-mono text-xs text-hackclub-purple font-bold shrink-0">{f.sku}</span>
                                        </div>
                                        <div className="text-sm text-hackclub-slate font-medium">{f.detail}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
