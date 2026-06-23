'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface Row {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    size?: string;
    color?: string;
    stock: number | null;     // null = untracked/unlimited
    reserved: number;
    available: number | null;
}

const LOW_THRESHOLD = 5;

export default function InventoryAdmin() {
    const { data: session, status } = useSession();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [lowOnly, setLowOnly] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [edits, setEdits] = useState<Record<string, string>>({});

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: '/admin/inventory' });
    }, [status]);

    const load = async () => {
        try {
            const res = await fetch('/api/admin/inventory');
            if (!res.ok) {
                setError(res.status === 403 ? 'You don’t have permission to manage inventory.' : 'Failed to load inventory');
                return;
            }
            const data = await res.json();
            setRows(data.rows || []);
        } catch {
            setError('Failed to load inventory');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (session) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    const sync = async () => {
        setSyncing(true);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch('/api/admin/inventory/sync', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || data.ok === false) {
                setError(data.error || 'Sync failed');
            } else {
                setNotice(`Synced ${data.synced} variant${data.synced === 1 ? '' : 's'} from Airtable.`);
                await load();
            }
        } catch {
            setError('Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    const saveStock = async (row: Row) => {
        const raw = edits[row.variantId];
        if (raw === undefined) return;
        const trimmed = raw.trim();
        const stock = trimmed === '' ? null : parseInt(trimmed, 10);
        if (stock !== null && (Number.isNaN(stock) || stock < 0)) {
            setError('Stock must be a non-negative number (or blank for unlimited).');
            return;
        }
        setSavingId(row.variantId);
        setError(null);
        try {
            const res = await fetch('/api/admin/inventory', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: row.productId, variantId: row.variantId, stock }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Could not save');
                return;
            }
            setRows(prev => prev.map(r =>
                r.variantId === row.variantId
                    ? { ...r, stock: data.stock, available: data.stock === null ? null : Math.max(0, data.stock - r.reserved) }
                    : r,
            ));
            setEdits(prev => { const n = { ...prev }; delete n[row.variantId]; return n; });
        } catch {
            setError('Could not save');
        } finally {
            setSavingId(null);
        }
    };

    const visible = useMemo(() => {
        if (!lowOnly) return rows;
        return rows.filter(r => r.available !== null && r.available <= LOW_THRESHOLD);
    }, [rows, lowOnly]);

    if (status === 'loading' || (session && loading)) {
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
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                        ← Back to Dashboard
                    </Link>
                    <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
                        <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark">Inventory</h1>
                        <button
                            type="button"
                            onClick={sync}
                            disabled={syncing}
                            className="bg-hackclub-blue hover:bg-blue-600 text-white font-bold px-5 py-2.5 rounded-full transition-colors disabled:opacity-50"
                        >
                            {syncing ? 'Syncing…' : 'Sync from Airtable'}
                        </button>
                    </div>
                    <p className="text-lg text-hackclub-slate font-medium mb-6">
                        Stock is tracked per variant. Leave a stock field blank for unlimited. Airtable is the source of truth — edits here also update the product and re-sync to Airtable. For cost, valuation, and margins, see <Link href="/admin/finance" className="text-hackclub-blue hover:underline font-bold">Finance</Link>.
                    </p>

                    <div className="mb-6">
                        <button
                            type="button"
                            onClick={() => setLowOnly(v => !v)}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border-2 transition-colors ${lowOnly ? 'bg-hackclub-orange text-white border-hackclub-orange' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}
                            aria-pressed={lowOnly}
                        >
                            <span className={`w-2 h-2 rounded-full ${lowOnly ? 'bg-white' : 'bg-hackclub-muted'}`} />
                            Low stock only (≤ {LOW_THRESHOLD})
                        </button>
                    </div>

                    {error && (
                        <div className="mb-4 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </div>
                    )}
                    {notice && (
                        <div className="mb-4 p-4 bg-hackclub-green/10 border-2 border-hackclub-green/40 rounded-xl">
                            <p className="text-hackclub-green font-bold">{notice}</p>
                        </div>
                    )}

                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-hackclub-snow border-b-2 border-hackclub-smoke">
                                    <tr className="text-left text-hackclub-muted font-black uppercase text-xs">
                                        <th className="px-4 py-3">Product / Variant</th>
                                        <th className="px-4 py-3 text-right">Stock</th>
                                        <th className="px-4 py-3 text-right">Reserved</th>
                                        <th className="px-4 py-3 text-right">Available</th>
                                        <th className="px-4 py-3 text-right">Set stock</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.length === 0 ? (
                                        <tr><td colSpan={5} className="px-4 py-10 text-center text-hackclub-muted font-bold">No variants{lowOnly ? ' are low on stock' : ''}.</td></tr>
                                    ) : visible.map(row => {
                                        const untracked = row.stock === null;
                                        const soldOut = row.available === 0;
                                        const low = row.available !== null && row.available > 0 && row.available <= LOW_THRESHOLD;
                                        return (
                                            <tr key={row.variantId} className="border-b border-hackclub-smoke last:border-0">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-hackclub-dark">{row.productName}</div>
                                                    <div className="text-hackclub-muted">{row.variantName}{row.size ? ` · ${row.size}` : ''}{row.color ? ` · ${row.color}` : ''}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">{untracked ? <span className="text-hackclub-muted">∞</span> : row.stock}</td>
                                                <td className="px-4 py-3 text-right font-mono">{row.reserved || 0}</td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                    {untracked ? (
                                                        <span className="text-hackclub-muted">∞</span>
                                                    ) : soldOut ? (
                                                        <span className="px-2 py-0.5 rounded-full text-xs font-black bg-hackclub-dark text-white">0</span>
                                                    ) : low ? (
                                                        <span className="px-2 py-0.5 rounded-full text-xs font-black bg-hackclub-orange text-white">{row.available}</span>
                                                    ) : (
                                                        <span className="text-hackclub-dark font-bold">{row.available}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            placeholder={untracked ? '∞' : String(row.stock)}
                                                            value={edits[row.variantId] ?? ''}
                                                            onChange={(e) => setEdits(prev => ({ ...prev, [row.variantId]: e.target.value }))}
                                                            className="w-20 rounded-lg border-2 border-hackclub-smoke px-2 py-1 text-right font-mono focus:outline-none focus:border-hackclub-blue"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => saveStock(row)}
                                                            disabled={savingId === row.variantId || edits[row.variantId] === undefined}
                                                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-hackclub-green hover:bg-green-600 disabled:opacity-40"
                                                        >
                                                            {savingId === row.variantId ? '…' : 'Save'}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
