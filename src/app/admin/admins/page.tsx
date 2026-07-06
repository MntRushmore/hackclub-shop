'use client';

import { useState, useEffect } from 'react';
import { useAdmin, PageHeader, Card, ErrorBanner, EmptyState, LoadingScreen } from '../ui';

interface AdminUser {
    userId: string;
    role: 'manager' | 'store_manager' | 'reader';
}

export default function AdminsAdmin() {
    const { permissions } = useAdmin();
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [globalAdmins, setGlobalAdmins] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [userId, setUserId] = useState('');
    const [role, setRole] = useState<'manager' | 'store_manager' | 'reader'>('reader');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!permissions.canManageAdmins) {
            setLoading(false);
            return;
        }
        const fetchAdmins = async () => {
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

        fetchAdmins();
    }, [permissions.canManageAdmins]);

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

    if (!permissions.canManageAdmins) {
        return <ErrorBanner message="You don’t have permission to manage admins." />;
    }

    if (loading) {
        return <LoadingScreen />;
    }

    const roleDescriptions: Record<'manager' | 'store_manager' | 'reader', string> = {
        manager: 'Full access to all admin features',
        store_manager: 'Can manage products and view stats',
        reader: 'View-only access to stats',
    };

    return (
        <>
            <PageHeader
                title="Admins"
                subtitle="Manage admin roles and permissions"
                actions={
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="bg-hackclub-yellow hover:bg-hackclub-yellow/80 text-hackclub-dark font-black py-2 px-5 rounded-full transition-colors text-sm"
                    >
                        + Add Admin
                    </button>
                }
            />

            {error && <ErrorBanner message={error} />}

            {showForm && (
                <Card className="mb-8">
                    <h2 className="text-lg font-black text-hackclub-dark mb-4">Add Admin</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-hackclub-slate mb-2">User ID</label>
                            <input
                                type="text"
                                placeholder="Enter user ID"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                required
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-hackclub-slate mb-2">Role</label>
                            <select
                                value={role}
                                onChange={(e) => setRole(e.target.value as 'manager' | 'store_manager' | 'reader')}
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
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
                </Card>
            )}

            {/* Global Admins */}
            {globalAdmins.length > 0 && (
                <Card className="mb-8">
                    <h2 className="text-lg font-black text-hackclub-dark mb-4">Global Admins (from .env)</h2>
                    <div className="space-y-2">
                        {globalAdmins.map((userId) => (
                            <div key={userId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
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
                </Card>
            )}

            {/* Admin Users */}
            <div className="space-y-4">
                <h2 className="text-lg font-black text-hackclub-dark">Admin Users</h2>
                {admins.filter(a => !globalAdmins.includes(a.userId)).length === 0 ? (
                    <EmptyState message="No admin users yet" />
                ) : (
                    admins
                        .filter(a => !globalAdmins.includes(a.userId))
                        .map((admin) => (
                            <Card key={admin.userId} className="flex items-center justify-between">
                                <div className="flex-1">
                                    <p className="font-bold text-hackclub-dark">{admin.userId}</p>
                                    <p className="text-xs text-hackclub-slate capitalize mt-1">{admin.role.replace('_', ' ')}</p>
                                    <p className="text-xs text-hackclub-muted mt-1">{roleDescriptions[admin.role]}</p>
                                </div>
                                <button
                                    onClick={() => handleDelete(admin.userId)}
                                    className="ml-4 px-4 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors"
                                >
                                    Remove
                                </button>
                            </Card>
                        ))
                )}
            </div>
        </>
    );
}
