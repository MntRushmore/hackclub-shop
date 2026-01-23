'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Product } from '../../../types/Admin';

interface FormCheckoutField {
    id: string;
    name: string;
    label: string;
    type: string;
    required: boolean;
}

export default function ProductsAdmin() {
    const { data: session, status } = useSession();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        image_url: '',
        thumbnail_url: '',
        category: '',
        variants: [{ id: '', variant_id: '', name: '', price: '', pointsPrice: '', size: '', color: '', image_url: '', stock: '' }],
        shippingOptions: [{ id: '', country: '', cost: '' }],
        checkoutFields: [] as FormCheckoutField[],
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/products' });
        }
    }, [status]);

    useEffect(() => {
        const fetchProducts = async () => {
            if (!session) return;

            try {
                const res = await fetch('/api/admin/products');
                if (!res.ok) {
                    setError('Failed to fetch products');
                    return;
                }
                const data = await res.json();
                setProducts(data.products || []);
            } catch {
                setError('Failed to fetch products');
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            fetchProducts();
        }
    }, [session]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const url = editingId ? `/api/admin/products/${editingId}` : '/api/admin/products';
            const method = editingId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    variants: formData.variants.filter(v => v.name && v.price).map(v => ({
                        ...v,
                        price: parseFloat(v.price),
                        pointsPrice: parseFloat(v.pointsPrice || '0'),
                        stock: v.stock ? parseInt(v.stock) : undefined,
                    })),
                    shippingOptions: formData.shippingOptions.filter(s => s.country && s.cost).map(s => ({
                        ...s,
                        cost: parseFloat(s.cost),
                    })),
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || `Failed to ${editingId ? 'update' : 'create'} product`);
                setSubmitting(false);
                return;
            }

            const data = await res.json();
            if (editingId) {
                setProducts(products.map(p => (p.id === editingId ? data.product : p)));
            } else {
                setProducts([...products, data.product]);
            }
            setFormData({
                name: '',
                description: '',
                image_url: '',
                thumbnail_url: '',
                category: '',
                variants: [{ id: '', variant_id: '', name: '', price: '', pointsPrice: '', size: '', color: '', image_url: '', stock: '' }],
                shippingOptions: [{ id: '', country: '', cost: '' }],
                checkoutFields: [],
            });
            setShowForm(false);
            setEditingId(null);
        } catch {
            setError(`Failed to ${editingId ? 'update' : 'create'} product`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = (product: Product) => {
        setEditingId(product.id);
        setFormData({
            name: product.name,
            description: product.description,
            image_url: product.image_url || '',
            thumbnail_url: product.thumbnail_url || '',
            category: product.category || '',
            variants: (product.variants || []).map(v => ({
                id: v.id,
                variant_id: v.variant_id,
                name: v.name,
                price: v.price.toString(),
                pointsPrice: v.pointsPrice?.toString() || '',
                size: v.size || '',
                color: v.color || '',
                image_url: v.image_url || '',
                stock: v.stock?.toString() || '',
            })) || [{ id: '', variant_id: '', name: '', price: '', pointsPrice: '', size: '', color: '', image_url: '', stock: '' }],
            shippingOptions: (product.shippingOptions || []).map(s => ({
                id: s.id,
                country: s.country,
                cost: s.cost.toString(),
            })) || [{ id: '', country: '', cost: '' }],
            checkoutFields: product.checkoutFields || [],
        });
        setShowForm(true);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setFormData({
            name: '',
            description: '',
            image_url: '',
            thumbnail_url: '',
            category: '',
            variants: [{ id: '', variant_id: '', name: '', price: '', pointsPrice: '', size: '', color: '', image_url: '', stock: '' }],
            shippingOptions: [{ id: '', country: '', cost: '' }],
            checkoutFields: [],
        });
        setShowForm(false);
    };

    const handleDelete = async (productId: string) => {
        if (!confirm('Are you sure you want to delete this product?')) return;

        try {
            const res = await fetch(`/api/admin/products/${productId}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                setError('Failed to delete product');
                return;
            }

            setProducts(products.filter(p => p.id !== productId));
        } catch {
            setError('Failed to delete product');
        }
    };

    if (status === 'loading' || (session && loading)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

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
                                Products
                            </h1>
                            <p className="text-lg text-hackclub-slate font-medium">
                                Manage your product catalog
                            </p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => (showForm ? cancelEdit() : setShowForm(true))}
                            className="bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                        >
                            {showForm ? 'Cancel' : '+ New Product'}
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
                                <h2 className="text-2xl font-black text-hackclub-dark mb-6">
                                    {editingId ? 'Edit Product' : 'Create New Product'}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <input
                                            type="text"
                                            placeholder="Product Name"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            className="col-span-2 px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Category"
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                            className="col-span-2 px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Thumbnail URL"
                                            value={formData.thumbnail_url}
                                            onChange={(e) => setFormData({ ...formData, thumbnail_url: e.target.value })}
                                            className="col-span-2 px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Image URL"
                                            value={formData.image_url}
                                            onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                                            className="col-span-2 px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                        />
                                        <textarea
                                            placeholder="Description"
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            className="col-span-2 px-4 py-3 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                            rows={2}
                                        />
                                    </div>

                                    <div className="mt-6 pt-6 border-t-2 border-hackclub-smoke">
                                        <h3 className="text-lg font-black text-hackclub-dark mb-4">Variants</h3>
                                        <div className="space-y-4">
                                            {formData.variants.map((variant, idx) => (
                                                <div key={idx} className="p-4 border-2 border-hackclub-smoke/50 rounded-lg space-y-2">
                                                    <input
                                                        type="text"
                                                        placeholder="Variant Name"
                                                        value={variant.name}
                                                        onChange={(e) => {
                                                            const newVariants = [...formData.variants];
                                                            newVariants[idx].name = e.target.value;
                                                            setFormData({ ...formData, variants: newVariants });
                                                        }}
                                                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                    />
                                                    <div className="grid grid-cols-4 gap-2">
                                                        <input
                                                            type="number"
                                                            placeholder="Cash Price ($)"
                                                            step="0.01"
                                                            value={variant.price}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].price = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Points Price"
                                                            step="1"
                                                            value={variant.pointsPrice}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].pointsPrice = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="Size"
                                                            value={variant.size}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].size = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="Color"
                                                            value={variant.color}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].color = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Variant Image URL"
                                                            value={variant.image_url}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].image_url = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="col-span-2 px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium text-sm"
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Stock"
                                                            value={variant.stock}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].stock = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        {formData.variants.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const newVariants = formData.variants.filter((_, i) => i !== idx);
                                                                    setFormData({ ...formData, variants: newVariants });
                                                                }}
                                                                className="px-3 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors text-sm"
                                                            >
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    variants: [...formData.variants, { id: '', variant_id: '', name: '', price: '', pointsPrice: '', size: '', color: '', image_url: '', stock: '' }]
                                                })}
                                                className="w-full px-4 py-2 border-2 border-dashed border-hackclub-green text-hackclub-green font-bold rounded-lg hover:bg-hackclub-green/10 transition-colors"
                                            >
                                                + Add Variant
                                            </button>
                                        </div>
                                    </div>

                                    {/* Shipping Options */}
                                    <div className="mt-6 pt-6 border-t-2 border-hackclub-smoke">
                                        <h3 className="text-lg font-black text-hackclub-dark mb-4">Shipping Options</h3>
                                        <div className="space-y-4">
                                            {formData.shippingOptions.map((shipping, idx) => (
                                                <div key={idx} className="p-4 border-2 border-hackclub-smoke/50 rounded-lg space-y-2">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Country"
                                                            value={shipping.country}
                                                            onChange={(e) => {
                                                                const newShipping = [...formData.shippingOptions];
                                                                newShipping[idx].country = e.target.value;
                                                                setFormData({ ...formData, shippingOptions: newShipping });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Cost"
                                                            step="0.01"
                                                            value={shipping.cost}
                                                            onChange={(e) => {
                                                                const newShipping = [...formData.shippingOptions];
                                                                newShipping[idx].cost = e.target.value;
                                                                setFormData({ ...formData, shippingOptions: newShipping });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                    </div>
                                                    {formData.shippingOptions.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const newShipping = formData.shippingOptions.filter((_, i) => i !== idx);
                                                                setFormData({ ...formData, shippingOptions: newShipping });
                                                            }}
                                                            className="w-full px-3 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors text-sm"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    shippingOptions: [...formData.shippingOptions, { id: '', country: '', cost: '' }]
                                                })}
                                                className="w-full px-4 py-2 border-2 border-dashed border-hackclub-green text-hackclub-green font-bold rounded-lg hover:bg-hackclub-green/10 transition-colors"
                                            >
                                                + Add Shipping Option
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-4">
                                        <button
                                            type="submit"
                                            disabled={submitting}
                                            className="flex-1 bg-hackclub-green hover:bg-hackclub-green/80 text-white font-black py-3 rounded-lg transition-colors disabled:bg-gray-300"
                                        >
                                            {submitting ? (editingId ? 'Updating...' : 'Creating...') : (editingId ? 'Update Product' : 'Create Product')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={cancelEdit}
                                            className="flex-1 bg-gray-300 hover:bg-gray-400 text-hackclub-dark font-black py-3 rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="space-y-4">
                        <AnimatePresence initial={false}>
                            {products.filter(p => p.id !== editingId).length === 0 && !showForm ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-center py-12 bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke"
                                >
                                    <p className="text-hackclub-muted font-bold">No products yet</p>
                                </motion.div>
                            ) : (
                                products.filter(p => p.id !== editingId).map((product, index) => (
                                    <motion.div
                                        key={product.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6 flex items-center justify-between hover:shadow-xl transition-shadow"
                                    >
                                        <div className="flex-1">
                                            <h3 className="text-xl font-black text-hackclub-dark mb-1">{product.name}</h3>
                                            <p className="text-hackclub-muted text-sm mb-2">{product.description}</p>
                                            <div className="text-sm space-y-1">
                                                {product.category && <span className="text-hackclub-slate font-bold">Category: {product.category}</span>}
                                                <div className="text-hackclub-slate font-bold">
                                                    {(product.variants || []).length} variant{(product.variants || []).length !== 1 ? 's' : ''}
                                                    {(product.variants || []).length > 0 && ` ($${Math.min(...(product.variants || []).map(v => v.price)).toFixed(2)} - $${Math.max(...(product.variants || []).map(v => v.price)).toFixed(2)})`}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="ml-4 flex gap-2">
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleEdit(product)}
                                                className="px-4 py-2 bg-hackclub-blue/10 hover:bg-hackclub-blue text-hackclub-blue hover:text-white font-bold rounded-lg transition-colors"
                                            >
                                                Edit
                                            </motion.button>
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleDelete(product.id)}
                                                className="px-4 py-2 bg-hackclub-red/10 hover:bg-hackclub-red text-hackclub-red hover:text-white font-bold rounded-lg transition-colors"
                                            >
                                                Delete
                                            </motion.button>
                                        </div>
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
