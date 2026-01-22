'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';

export default function UsersAdmin() {
    const { status } = useSession();
    const [userId, setUserId] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    if (status === 'unauthenticated') {
        return (
            <div onClick={() => signIn('hackclub', { callbackUrl: '/admin/users' })} className="cursor-pointer">
                Sign in
            </div>
        );
    }

    const handleAdjustBalance = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            const res = await fetch(`/api/admin/users/${userId}/balance`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    reason,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setMessage({ type: 'error', text: data.error || 'Failed to adjust balance' });
                setLoading(false);
                return;
            }

            setMessage({
                type: 'success',
                text: `Balance adjusted. New balance: $${data.newBalance.toFixed(2)}`,
            });
            setUserId('');
            setAmount('');
            setReason('');
        } catch {
            setMessage({ type: 'error', text: 'Failed to adjust balance' });
        } finally {
            setLoading(false);
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
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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
                    <p className="text-lg text-hackclub-slate font-medium mb-12">
                        Adjust user balances and credits
                    </p>

                    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8">
                        <h2 className="text-2xl font-black text-hackclub-dark mb-6">Adjust User Balance</h2>

                        {message && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`mb-6 p-4 rounded-xl border-2 ${
                                    message.type === 'success'
                                        ? 'bg-hackclub-green/10 border-hackclub-green'
                                        : 'bg-hackclub-red/10 border-hackclub-red'
                                }`}
                            >
                                <p className={`font-bold ${message.type === 'success' ? 'text-hackclub-green' : 'text-hackclub-red'}`}>
                                    {message.text}
                                </p>
                            </motion.div>
                        )}

                        <form onSubmit={handleAdjustBalance} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-hackclub-slate mb-2">User ID (Slack ID)</label>
                                <input
                                    type="text"
                                    placeholder="Enter user Slack ID (e.g. U08T4JQJRJA)"
                                    value={userId}
                                    onChange={(e) => setUserId(e.target.value)}
                                    required
                                    className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-hackclub-slate mb-2">Amount</label>
                                    <input
                                        type="number"
                                        placeholder="Amount ($)"
                                        step="0.01"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-hackclub-slate mb-2">Reason</label>
                                    <select
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        required
                                        className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                    >
                                        <option value="">Select reason</option>
                                        <option value="refund">Refund</option>
                                        <option value="correction">Balance Correction</option>
                                        <option value="bonus">Bonus</option>
                                        <option value="promotion">Promotional Credit</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                            </div>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                type="submit"
                                disabled={loading}
                                className="w-full bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300 mt-6"
                            >
                                {loading ? 'Adjusting...' : 'Adjust Balance'}
                            </motion.button>
                        </form>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
