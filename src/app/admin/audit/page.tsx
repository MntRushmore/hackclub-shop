'use client';

import { useState, useEffect } from 'react';
import { PageHeader, Card, ErrorBanner, EmptyState, LoadingScreen } from '../ui';

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
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
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
    }, []);

    return (
        <>
            <PageHeader
                title="Audit Log"
                subtitle="Who did what: refunds, point grants, status changes, shipping, and stock edits."
            />

            {error && <ErrorBanner message={error} />}

            {loading ? (
                <LoadingScreen />
            ) : entries.length === 0 && !error ? (
                <EmptyState message="No actions recorded yet." />
            ) : (
                <Card padded={false} className="divide-y divide-gray-200">
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
                </Card>
            )}
        </>
    );
}
