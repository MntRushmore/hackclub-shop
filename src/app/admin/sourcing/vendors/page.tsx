'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Vendor } from '../../../../types/Sourcing';

const EMPTY = {
    name: '',
    website: '',
    contactName: '',
    contactEmail: '',
    tags: '',
    notes: '',
};

export default function VendorsAdmin() {
    const { data: session, status } = useSession();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/sourcing/vendors' });
        }
    }, [status]);

    useEffect(() => {
        if (!session) return;
        (async () => {
            try {
                const res = await fetch('/api/admin/sourcing/vendors');
                if (res.status === 403) {
                    setAllowed(false);
                    return;
                }
                if (!res.ok) {
                    setError('Failed to fetch vendors');
                    return;
                }
                const data = await res.json();
                setVendors(data.vendors || []);
            } catch {
                setError('Failed to fetch vendors');
            } finally {
                setLoading(false);
            }
        })();
    }, [session]);

    const resetForm = () => {
        setForm(EMPTY);
        setEditingId(null);
        setShowForm(false);
    };

    const startEdit = (v: Vendor) => {
        setForm({
            name: v.name,
            website: v.website || '',
            contactName: v.contactName || '',
            contactEmail: v.contactEmail || '',
            tags: (v.tags || []).join(', '),
            notes: v.notes || '',
        });
        setEditingId(v.id);
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        const payload = {
            name: form.name.trim(),
            website: form.website.trim(),
            contactName: form.contactName.trim(),
            contactEmail: form.contactEmail.trim(),
            notes: form.notes.trim(),
            tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        };

        try {
            const res = await fetch(
                editingId ? `/api/admin/sourcing/vendors/${editingId}` : '/api/admin/sourcing/vendors',
                {
                    method: editingId ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to save vendor');
                setSubmitting(false);
                return;
            }
            const { vendor } = await res.json();
            setVendors((prev) =>
                editingId ? prev.map((v) => (v.id === vendor.id ? vendor : v)) : [vendor, ...prev],
            );
            resetForm();
        } catch {
            setError('Failed to save vendor');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this vendor? Its quotes will remain but lose the vendor link.')) return;
        try {
            const res = await fetch(`/api/admin/sourcing/vendors/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError('Failed to delete vendor');
                return;
            }
            setVendors((prev) => prev.filter((v) => v.id !== id));
        } catch {
            setError('Failed to delete vendor');
        }
    };

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (session && !allowed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Access Denied</h2>
                    <p className="text-hackclub-slate mb-6">You don&apos;t have permission to manage sourcing.</p>
                    <Link href="/admin" className="inline-block w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const inputClass =
        'w-full px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-blue text-hackclub-dark font-medium';

    return (
        <div
            className="min-h-screen bg-white text-hackclub-dark"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <div className="flex items-center justify-between mb-12">
                        <div>
                            <Link href="/admin/sourcing" className="text-hackclub-slate hover:text-hackclub-dark mb-2 inline-block font-medium">
                                ← Back to Sourcing
                            </Link>
                            <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">Vendors</h1>
                            <p className="text-lg text-hackclub-slate font-medium">Suppliers you source merch from</p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => (showForm ? resetForm() : setShowForm(true))}
                            className="bg-hackclub-blue hover:bg-hackclub-blue/80 text-white font-black py-3 px-6 rounded-full transition-colors"
                        >
                            {showForm ? 'Cancel' : '+ New Vendor'}
                        </motion.button>
                    </div>

                    {error && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                            <p className="text-hackclub-red font-bold">{error}</p>
                        </motion.div>
                    )}

                    <AnimatePresence>
                        {showForm && (
                            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="mb-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-8">
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">
                                    {editingId ? 'Edit Vendor' : 'New Vendor'}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <input className={inputClass} placeholder="Vendor name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <input className={inputClass} placeholder="Website (https://…)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                                        <input className={inputClass} placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                                        <input className={inputClass} placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
                                        <input className={inputClass} type="email" placeholder="Contact email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
                                    </div>
                                    <textarea className={inputClass} rows={3} placeholder="Notes (markdown ok)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                                    <button type="submit" disabled={submitting} className="bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 px-6 rounded-full transition-colors disabled:opacity-50">
                                        {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Create Vendor'}
                                    </button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {vendors.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-hackclub-smoke">
                            <p className="text-hackclub-slate font-bold text-lg mb-1">No vendors yet</p>
                            <p className="text-hackclub-slate text-sm">Add your first supplier to start logging quotes.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {vendors.map((v) => (
                                <div key={v.id} className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 flex flex-col">
                                    <div className="flex items-start justify-between mb-2">
                                        <h3 className="text-xl font-black text-hackclub-dark">{v.name}</h3>
                                    </div>
                                    {v.website && (
                                        <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-hackclub-blue hover:underline text-sm font-medium break-all mb-2">
                                            {v.website.replace(/^https?:\/\//, '')}
                                        </a>
                                    )}
                                    {(v.contactName || v.contactEmail) && (
                                        <p className="text-hackclub-slate text-sm mb-2">
                                            {v.contactName}
                                            {v.contactName && v.contactEmail ? ' · ' : ''}
                                            {v.contactEmail && (
                                                <a href={`mailto:${v.contactEmail}`} className="hover:underline">
                                                    {v.contactEmail}
                                                </a>
                                            )}
                                        </p>
                                    )}
                                    {v.tags && v.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                            {v.tags.map((t) => (
                                                <span key={t} className="text-xs font-bold bg-hackclub-blue/10 text-hackclub-blue px-2 py-0.5 rounded-full">
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {v.notes && <p className="text-hackclub-slate text-sm whitespace-pre-wrap mb-3">{v.notes}</p>}
                                    <div className="mt-auto flex gap-2 pt-3">
                                        <Link href={`/admin/sourcing/quotes?vendorId=${v.id}`} className="text-sm font-bold text-hackclub-green hover:underline">
                                            View quotes
                                        </Link>
                                        <span className="text-hackclub-smoke">·</span>
                                        <button onClick={() => startEdit(v)} className="text-sm font-bold text-hackclub-slate hover:text-hackclub-dark">
                                            Edit
                                        </button>
                                        <span className="text-hackclub-smoke">·</span>
                                        <button onClick={() => handleDelete(v.id)} className="text-sm font-bold text-hackclub-red hover:underline">
                                            Delete
                                        </button>
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
