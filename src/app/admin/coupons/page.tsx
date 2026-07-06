'use client';

import { useState, useEffect } from 'react';
import { Coupon } from '../../../types/Admin';
import { PageHeader, Card, ErrorBanner, EmptyState, LoadingScreen } from '../ui';

export default function CouponsAdmin() {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        code: '',
        discountType: 'percentage' as 'percentage' | 'fixed',
        discountValue: '',
        usageType: 'reusable' as 'single' | 'reusable' | 'limited',
        usageLimit: '',
        active: true,
        expiresAt: '',
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const fetchCoupons = async () => {
            try {
                const res = await fetch('/api/admin/coupons');
                if (!res.ok) {
                    setError('Failed to fetch coupons');
                    return;
                }
                const data = await res.json();
                setCoupons(data.coupons || []);
            } catch {
                setError('Failed to fetch coupons');
            } finally {
                setLoading(false);
            }
        };

        fetchCoupons();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch('/api/admin/coupons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    discountValue: parseFloat(formData.discountValue),
                    usageLimit: formData.usageType === 'limited' ? parseInt(formData.usageLimit) : undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to create coupon');
                setSubmitting(false);
                return;
            }

            const data = await res.json();
            setCoupons([...coupons, data.coupon]);
            setFormData({
                code: '',
                discountType: 'percentage',
                discountValue: '',
                usageType: 'reusable',
                usageLimit: '',
                active: true,
                expiresAt: '',
            });
            setShowForm(false);
        } catch {
            setError('Failed to create coupon');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (couponId: string) => {
        if (!confirm('Are you sure you want to delete this coupon?')) return;

        try {
            const res = await fetch(`/api/admin/coupons/${couponId}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                setError('Failed to delete coupon');
                return;
            }

            setCoupons(coupons.filter(c => c.id !== couponId));
        } catch {
            setError('Failed to delete coupon');
        }
    };

    if (loading) {
        return (
            <>
                <PageHeader title="Coupons" subtitle="Create and manage discount codes" />
                <LoadingScreen />
            </>
        );
    }

    return (
        <>
            <PageHeader
                title="Coupons"
                subtitle="Create and manage discount codes"
                actions={
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="rounded-full bg-hackclub-green px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-hackclub-green/80"
                    >
                        + New Coupon
                    </button>
                }
            />

            {error && <ErrorBanner message={error} />}

            {showForm && (
                <Card className="mb-6">
                    <h2 className="text-lg font-black text-hackclub-dark mb-6">Create New Coupon</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <input
                                type="text"
                                placeholder="Coupon Code"
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                required
                                className="col-span-2 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                            />

                            <div>
                                <label className="block text-sm font-bold text-hackclub-slate mb-2">Discount Type</label>
                                <select
                                    value={formData.discountType}
                                    onChange={(e) => setFormData({ ...formData, discountType: e.target.value as 'percentage' | 'fixed' })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                >
                                    <option value="percentage">Percentage (%)</option>
                                    <option value="fixed">Fixed ($)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-hackclub-slate mb-2">Discount Value</label>
                                <input
                                    type="number"
                                    placeholder="Amount"
                                    step="0.01"
                                    value={formData.discountValue}
                                    onChange={(e) => setFormData({ ...formData, discountValue: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-hackclub-slate mb-2">Usage Type</label>
                                <select
                                    value={formData.usageType}
                                    onChange={(e) => setFormData({ ...formData, usageType: e.target.value as 'single' | 'reusable' | 'limited' })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                >
                                    <option value="reusable">Reusable</option>
                                    <option value="single">Single Use</option>
                                    <option value="limited">Limited Uses</option>
                                </select>
                            </div>

                            {formData.usageType === 'limited' && (
                                <div>
                                    <label className="block text-sm font-bold text-hackclub-slate mb-2">Usage Limit</label>
                                    <input
                                        type="number"
                                        placeholder="Max uses"
                                        value={formData.usageLimit}
                                        onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })}
                                        required
                                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-hackclub-slate mb-2">Expires At</label>
                                <input
                                    type="datetime-local"
                                    value={formData.expiresAt}
                                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                />
                            </div>

                            <div className="flex items-center">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.active}
                                        onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                                        className="w-5 h-5"
                                    />
                                    <span className="font-bold text-hackclub-dark">Active</span>
                                </label>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                disabled={submitting}
                                className="flex-1 bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300"
                            >
                                {submitting ? 'Creating...' : 'Create Coupon'}
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

            <div className="space-y-4">
                {coupons.length === 0 ? (
                    <EmptyState message="No coupons yet" />
                ) : (
                    coupons.map((coupon) => (
                        <Card key={coupon.id}>
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                        <h3 className="text-lg font-black text-hackclub-dark">{coupon.code}</h3>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                            coupon.active
                                                ? 'bg-hackclub-green/10 text-hackclub-green'
                                                : 'bg-hackclub-red/10 text-hackclub-red'
                                        }`}>
                                            {coupon.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                            <p className="text-hackclub-muted font-bold">Discount</p>
                                            <p className="text-hackclub-dark font-black">
                                                {coupon.discountType === 'percentage'
                                                    ? `${coupon.discountValue}%`
                                                    : `$${coupon.discountValue.toFixed(2)}`}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-hackclub-muted font-bold">Usage</p>
                                            <p className="text-hackclub-dark font-black">
                                                {coupon.usageType === 'reusable' && 'Reusable'}
                                                {coupon.usageType === 'single' && 'Single'}
                                                {coupon.usageType === 'limited' && `Limited (${coupon.usageCount}/${coupon.usageLimit})`}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-hackclub-muted font-bold">Total Uses</p>
                                            <p className="text-hackclub-dark font-black">{coupon.usageCount}</p>
                                        </div>
                                    </div>
                                    {coupon.expiresAt && (
                                        <p className="text-xs text-hackclub-slate mt-3">
                                            Expires: {new Date(coupon.expiresAt).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleDelete(coupon.id)}
                                    className="ml-4 px-4 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </>
    );
}
