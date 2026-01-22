'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';

interface AdminUser {
    userId: string;
    role: 'manager' | 'store_manager' | 'reader';
}

export default function AdminsAdmin() {
    const { data: session, status } = useSession();
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [globalAdmins, setGlobalAdmins] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [userId, setUserId] = useState('');
    const [role, setRole] = useState<'manager' | 'store_manager' | 'reader'>('reader');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/admins' });
        }
    }, [status]);

    useEffect(() => {
        const fetchAdmins = async () => {
            if (!session) return;

            try {
                const res = await fetch('/api/admin/admins');
                if (!res.ok) {
                    setError('Failed to fetch admins');
                    return;
                }
                const data = await res.json();
                setAdmins(data.admins || []);
                setGlobalAdmins(data.globalAdmins || []);
            } catch {
                setError('Failed to fetch admins');
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            fetchAdmins();
        }
    }, [session]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch('/api/admin/admins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    role,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to add admin');
                setSubmitting(false);
                return;
            }

            const newAdmin: AdminUser = {
                userId,
                role,
            };

            const existing = admins.find(a => a.userId === userId);
            if (existing) {
                setAdmins(admins.map(a => (a.userId === userId ? newAdmin : a)));
            } else {
                setAdmins([...admins, newAdmin]);
            }

            setUserId('');
            setRole('reader');
            setShowForm(false);
        } catch {
            setError('Failed to add admin');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (userId: string) => {
        if (!confirm('Are you sure you want to remove this admin?')) return;

        try {
            const res = await fetch(`/api/admin/admins/${userId}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                setError('Failed to remove admin');
                return;
            }

            setAdmins(admins.filter(a => a.userId !== userId));
        } catch {
            setError('Failed to remove admin');
        }
    };

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    const roleDescriptions: Record<'manager' | 'store_manager' | 'reader', string> = {
        manager: 'Full access to all admin features',
        store_manager: 'Can manage products and view stats',
        reader: 'View-only access to stats',
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
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <div className="flex items-center justify-between mb-12">
                        <div>
                            <Link href="/admin" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                                ← Back to Dashboard
                            </Link>
                            <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                                Admins
                            </h1>
                            <p className="text-lg text-hackclub-slate font-medium">
                                Manage admin roles and permissions
                            </p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setShowForm(!showForm)}
                            className="bg-hackclub-yellow hover:bg-hackclub-yellow/80 text-hackclub-dark font-black py-3 px-6 rounded-full transition-colors"
                        >
                            + Add Admin
                        </motion.button>
                    </div>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl"
                        >
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    <AnimatePresence>
                        {showForm && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="mb-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8"
                            >
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">Add Admin</h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-hackclub-slate mb-2">User ID</label>
                                        <input
                                            type="text"
                                            placeholder="Enter user ID"
                                            value={userId}
                                            onChange={(e) => setUserId(e.target.value)}
                                            required
                                            className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-hackclub-slate mb-2">Role</label>
                                        <select
                                            value={role}
                                            onChange={(e) => setRole(e.target.value as 'manager' | 'store_manager' | 'reader')}
                                            className="w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        >
                                            <option value="reader">Reader (View Stats)</option>
                                            <option value="store_manager">Store Manager (Products + Stats)</option>
                                            <option value="manager">Manager (Full Access)</option>
                                        </select>
                                        <p className="text-xs text-hackclub-muted mt-2">{roleDescriptions[role]}</p>
                                    </div>

                                    <div className="flex gap-3 pt-4">
                                        <button
                                            type="submit"
                                            disabled={submitting}
                                            className="flex-1 bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300"
                                        >
                                            {submitting ? 'Adding...' : 'Add Admin'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowForm(false)}
                                            className="flex-1 bg-gray-300 hover:bg-gray-400 text-hackclub-dark font-black py-3 rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Global Admins */}
                    {globalAdmins.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="mb-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-yellow p-6"
                        >
                            <h2 className="text-xl font-black text-hackclub-dark mb-4">Global Admins (from .env)</h2>
                            <div className="space-y-2">
                                {globalAdmins.map((userId) => (
                                    <div key={userId} className="flex items-center justify-between p-3 bg-hackclub-yellow/10 rounded-lg">
                                        <div>
                                            <p className="font-bold text-hackclub-dark">{userId}</p>
                                            <p className="text-xs text-hackclub-slate">Manager</p>
                                        </div>
                                        <span className="px-3 py-1 bg-hackclub-yellow/20 text-hackclub-yellow font-bold text-xs rounded-full">
                                            Global
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* Admin Users */}
                    <div className="space-y-4">
                        <h2 className="text-2xl font-black text-hackclub-dark mb-6">Admin Users</h2>
                        <AnimatePresence initial={false}>
                            {admins.filter(a => !globalAdmins.includes(a.userId)).length === 0 ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-center py-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke"
                                >
                                    <p className="text-hackclub-muted font-bold">No admin users yet</p>
                                </motion.div>
                            ) : (
                                admins
                                    .filter(a => !globalAdmins.includes(a.userId))
                                    .map((admin, index) => (
                                        <motion.div
                                            key={admin.userId}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 flex items-center justify-between hover:shadow-xl transition-shadow"
                                        >
                                            <div className="flex-1">
                                                <p className="font-bold text-hackclub-dark">{admin.userId}</p>
                                                <p className="text-xs text-hackclub-slate capitalize mt-1">{admin.role.replace('_', ' ')}</p>
                                                <p className="text-xs text-hackclub-muted mt-1">{roleDescriptions[admin.role]}</p>
                                            </div>
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleDelete(admin.userId)}
                                                className="ml-4 px-4 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors"
                                            >
                                                Remove
                                            </motion.button>
                                        </motion.div>
                                    ))
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
