'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface AuditEntry {
    id: string;
    action: string;
    actorId: string;
    actorEmail?: string;
    target?: string;
    summary: string;
    timestamp: string;
}

const ACTION_COLOR: Record<string, string> = {
    'order.approve': 'bg-blue-100 text-blue-800',
    'order.deny': 'bg-red-100 text-red-800',
    'order.fulfill': 'bg-green-100 text-green-800',
    'order.refund': 'bg-orange-100 text-orange-800',
    'order.mark-delivered': 'bg-green-100 text-green-800',
    'order.ship': 'bg-cyan-100 text-cyan-800',
    'order.mark-test': 'bg-gray-100 text-gray-600',
    'order.unmark-test': 'bg-gray-100 text-gray-600',
    'points.grant': 'bg-green-100 text-green-800',
    'points.deduct': 'bg-red-100 text-red-800',
    'inventory.adjust': 'bg-purple-100 text-purple-800',
};

export default function AuditAdmin() {
    const { data: session, status } = useSession();
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: '/admin/audit' });
    }, [status]);

    useEffect(() => {
        if (!session) return;
        (async () => {
            try {
                const res = await fetch('/api/admin/audit?limit=200');
                if (!res.ok) {
                    setError(res.status === 403 ? 'You don’t have permission to view the audit log.' : 'Failed to load audit log');
                    return;
                }
                const data = await res.json();
                setEntries(data.entries || []);
            } catch {
                setError('Failed to load audit log');
            } finally {
                setLoading(false);
            }
        })();
    }, [session]);

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
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Audit Log</h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-8">
                        Who did what — refunds, point grants, status changes, shipping, and stock edits.
                    </p>

                    {error && (
                        <div className="mb-4 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </div>
                    )}

                    {entries.length === 0 && !error ? (
                        <div className="text-center py-16 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke">
                            <p className="text-hackclub-muted font-bold">No actions recorded yet.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke divide-y divide-hackclub-smoke">
                            {entries.map((e) => (
                                <div key={e.id} className="px-5 py-4 flex items-start gap-3">
                                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${ACTION_COLOR[e.action] || 'bg-gray-100 text-gray-700'}`}>
                                        {e.action}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-hackclub-dark">{e.summary}</p>
                                        <p className="text-xs text-hackclub-muted mt-0.5">
                                            {e.actorEmail || e.actorId} · {new Date(e.timestamp).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
