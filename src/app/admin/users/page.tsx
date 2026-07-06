'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin, PageHeader, Card, ErrorBanner, EmptyState } from '../ui';

interface AdminUserRow {
    userId: string;
    name: string | null;
    email: string | null;
    pointsBalance: number;
    slackId: string | null;
    role: string | null;
    orderCount: number;
}

export default function UsersAdmin() {
    const { permissions } = useAdmin();

    // Users list
    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);

    const loadUsers = useCallback(async () => {
        setUsersLoading(true);
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users || []);
            }
        } catch {
            // best-effort; list just stays empty
        } finally {
            setUsersLoading(false);
        }
    }, []);

    useEffect(() => {
        if (permissions.canManageUsers) loadUsers();
    }, [permissions.canManageUsers, loadUsers]);

    // Backfill state
    const [backfilling, setBackfilling] = useState(false);
    const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

    const runBackfill = useCallback(async () => {
        setBackfilling(true);
        setBackfillMessage(null);
        try {
            const res = await fetch('/api/admin/users/backfill-identity', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                const c = data.counts;
                setBackfillMessage(`Backfilled ${c.namesFilled} name(s) and ${c.emailsFilled} email(s) across ${c.scanned} user(s).`);
                loadUsers();
            } else {
                setBackfillMessage(data.error || 'Backfill failed');
            }
        } catch {
            setBackfillMessage('Backfill failed');
        } finally {
            setBackfilling(false);
        }
    }, [loadUsers]);

    // Points state
    const [pointsUserId, setPointsUserId] = useState('');
    const [pointsAmount, setPointsAmount] = useState('');
    const [pointsReason, setPointsReason] = useState('');
    const [pointsLoading, setPointsLoading] = useState(false);
    const [pointsMessage, setPointsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    if (!permissions.canManageUsers) {
        return <ErrorBanner message="You don’t have permission to manage users." />;
    }

    const handleAdjustPoints = async (e: React.FormEvent) => {
        e.preventDefault();
        setPointsLoading(true);
        setPointsMessage(null);

        try {
            const res = await fetch(`/api/admin/users/${pointsUserId}/points`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseInt(pointsAmount),
                    reason: pointsReason,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setPointsMessage({ type: 'error', text: data.error || 'Failed to adjust points' });
                setPointsLoading(false);
                return;
            }

            setPointsMessage({
                type: 'success',
                text: `Points adjusted. New balance: ${data.newBalance} points`,
            });
            setPointsUserId('');
            setPointsAmount('');
            setPointsReason('');
            loadUsers();
        } catch {
            setPointsMessage({ type: 'error', text: 'Failed to adjust points' });
        } finally {
            setPointsLoading(false);
        }
    };

    return (
        <>
            <PageHeader
                title="Users"
                subtitle="View users and adjust their points. Everyone here signed in with Hack Club; guest (HCB) buyers don’t appear in this list."
            />

            <Card className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-black text-hackclub-dark">All Users</h2>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={runBackfill}
                            disabled={backfilling}
                            title="Fill in missing names/emails for users who haven't logged in since this was added (pulls from Slack)."
                            className="text-sm font-bold text-hackclub-slate hover:text-hackclub-dark disabled:opacity-50"
                        >
                            {backfilling ? 'Backfilling…' : '⤓ Backfill names'}
                        </button>
                        <button
                            onClick={loadUsers}
                            className="text-sm font-bold text-hackclub-slate hover:text-hackclub-dark"
                        >
                            ↻ Refresh
                        </button>
                    </div>
                </div>

                {backfillMessage && (
                    <p className="text-sm font-medium text-hackclub-slate mb-4">{backfillMessage}</p>
                )}

                {usersLoading ? (
                    <p className="text-hackclub-slate font-medium">Loading users…</p>
                ) : users.length === 0 ? (
                    <EmptyState message="No users yet." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-hackclub-slate">
                                    <th className="py-2 pr-4 font-bold">User</th>
                                    <th className="py-2 pr-4 font-bold">Email</th>
                                    <th className="py-2 pr-4 font-bold">Points</th>
                                    <th className="py-2 pr-4 font-bold">Orders</th>
                                    <th className="py-2 pr-4 font-bold">Role</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => (
                                    <tr
                                        key={u.userId}
                                        onClick={() => { setPointsUserId(u.userId); }}
                                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <td className="py-2 pr-4">
                                            <div className="font-bold text-hackclub-dark">{u.name || 'Unknown'}</div>
                                            <div className="font-mono text-xs text-hackclub-slate">{u.userId}</div>
                                        </td>
                                        <td className="py-2 pr-4 text-hackclub-slate break-all">{u.email || '—'}</td>
                                        <td className="py-2 pr-4 font-bold text-hackclub-dark">{u.pointsBalance}</td>
                                        <td className="py-2 pr-4 text-hackclub-slate">{u.orderCount}</td>
                                        <td className="py-2 pr-4 text-hackclub-slate">{u.role || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="text-xs text-hackclub-slate mt-3">Click a row to fill the points form below with that user&apos;s ID.</p>
                    </div>
                )}
            </Card>

            <Card>
                <h2 className="text-lg font-black text-hackclub-dark mb-4">Adjust User Points</h2>

                {pointsMessage && (
                    pointsMessage.type === 'error' ? (
                        <ErrorBanner message={pointsMessage.text} />
                    ) : (
                        <div className="mb-4 rounded-lg border border-hackclub-green/30 bg-hackclub-green/5 px-4 py-3">
                            <p className="text-sm font-bold text-hackclub-green">{pointsMessage.text}</p>
                        </div>
                    )
                )}

                <form onSubmit={handleAdjustPoints} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-hackclub-slate mb-2">User ID (Slack ID)</label>
                        <input
                            type="text"
                            placeholder="Enter user Slack ID (e.g. U08T4JQJRJA)"
                            value={pointsUserId}
                            onChange={(e) => setPointsUserId(e.target.value)}
                            required
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Points Amount</label>
                            <input
                                type="number"
                                placeholder="Amount (points)"
                                value={pointsAmount}
                                onChange={(e) => setPointsAmount(e.target.value)}
                                required
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Reason</label>
                            <select
                                value={pointsReason}
                                onChange={(e) => setPointsReason(e.target.value)}
                                required
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                            >
                                <option value="">Select reason</option>
                                <option value="refund">Refund</option>
                                <option value="correction">Points Correction</option>
                                <option value="bonus">Bonus</option>
                                <option value="promotion">Promotional Points</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={pointsLoading}
                        className="w-full bg-hackclub-blue hover:bg-hackclub-blue/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300 mt-6"
                    >
                        {pointsLoading ? 'Adjusting...' : 'Adjust Points'}
                    </button>
                </form>
            </Card>
        </>
    );
}
