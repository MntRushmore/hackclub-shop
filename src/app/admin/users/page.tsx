'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

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
    const { status } = useSession();

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
        if (status === 'authenticated') loadUsers();
    }, [status, loadUsers]);
    
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

    if (status === 'unauthenticated') {
        return (
            <div onClick={() => signIn('hackclub', { callbackUrl: '/admin/users' })} className="cursor-pointer">
                Sign in
            </div>
        );
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
        <div className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                        Users
                    </h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-2">
                        View users and adjust their points
                    </p>
                    <p className="text-sm text-hackclub-slate/80 font-medium mb-12">
                        Everyone here signed in with Hack Club — guest (HCB) buyers don&apos;t appear in this list.
                    </p>

                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8 mb-8">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-black text-hackclub-dark">All Users</h2>
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
                            <p className="text-hackclub-slate font-medium">No users yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b-2 border-hackclub-smoke text-hackclub-slate">
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
                                                className="border-b border-hackclub-smoke/50 hover:bg-hackclub-smoke/20 cursor-pointer"
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
                    </div>

                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8 mt-12">
                        <h2 className="text-2xl font-black text-hackclub-dark mb-6">Adjust User Points</h2>

                        {pointsMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`mb-6 p-4 rounded-xl border-2 ${
                                    pointsMessage.type === 'success'
                                        ? 'bg-hackclub-green/10 border-hackclub-green'
                                        : 'bg-hackclub-red/10 border-hackclub-red'
                                }`}
                            >
                                <p className={`font-bold ${pointsMessage.type === 'success' ? 'text-hackclub-green' : 'text-hackclub-red'}`}>
                                    {pointsMessage.text}
                                </p>
                            </motion.div>
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
                                    className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
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
                                        className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-hackclub-slate mb-2">Reason</label>
                                    <select
                                        value={pointsReason}
                                        onChange={(e) => setPointsReason(e.target.value)}
                                        required
                                        className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
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

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                type="submit"
                                disabled={pointsLoading}
                                className="w-full bg-hackclub-blue hover:bg-hackclub-blue/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300 mt-6"
                            >
                                {pointsLoading ? 'Adjusting...' : 'Adjust Points'}
                            </motion.button>
                        </form>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
