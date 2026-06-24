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

interface ImageFieldProps {
    label: string;
    value: string;
    onChange: (url: string) => void;
    onUpload: (file: File) => Promise<string | null>;
    uploadingKey: string;
    uploading: string | null;
    setUploading: (key: string | null) => void;
    compact?: boolean;
}

function ImageField({ label, value, onChange, onUpload, uploadingKey, uploading, setUploading, compact }: ImageFieldProps) {
    const isUploading = uploading === uploadingKey;
    const inputPad = compact ? 'px-3 py-2' : 'px-4 py-3';

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(uploadingKey);
        const url = await onUpload(file);
        setUploading(null);
        if (url) onChange(url);
        e.target.value = '';
    };

    return (
        <div className={`${compact ? '' : 'col-span-2'} space-y-2`}>
            <div className="flex items-center gap-3">
                {value ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={value} alt={label} className="w-14 h-14 rounded-lg object-cover border-2 border-hackclub-smoke flex-shrink-0" />
                ) : (
                    <div className="w-14 h-14 rounded-lg border-2 border-dashed border-hackclub-smoke flex-shrink-0 flex items-center justify-center text-hackclub-muted text-xs">
                        none
                    </div>
                )}
                <label className={`cursor-pointer inline-flex items-center gap-2 ${inputPad} bg-hackclub-dark text-white rounded-lg font-bold text-sm hover:opacity-90 transition-opacity ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                    {isUploading ? 'Uploading…' : `Upload ${label}`}
                    <input type="file" accept="image/*" onChange={handleFile} className="hidden" disabled={isUploading} />
                </label>
                {value && (
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="text-sm text-hackclub-red font-bold hover:underline"
                    >
                        Remove
                    </button>
                )}
            </div>
            <input
                type="text"
                placeholder={`${label} (or paste a URL)`}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={`w-full ${inputPad} border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium text-sm`}
            />
        </div>
    );
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
        variants: [{
            id: '',
            variant_id: '',
            name: '',
            priceCash: '',
            pricePoints: '',
            size: '',
            color: '',
            image_url: '',
            stock: '',
            weightOz: '',
            unitCost: '',
            sku: ''
        }],
        shippingOptions: [{ id: '', country: '', cost: '', costPoints: '' }],
        checkoutFields: [] as FormCheckoutField[],
    });
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const uploadImage = async (file: File): Promise<string | null> => {
        setUploadError(null);
        const body = new FormData();
        body.append('file', file);
        try {
            const res = await fetch('/api/admin/upload', { method: 'POST', body });
            const data = await res.json();
            if (!res.ok) {
                setUploadError(data.error || 'Upload failed');
                return null;
            }
            return data.url as string;
        } catch {
            setUploadError('Upload failed');
            return null;
        }
    };

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
                    variants: formData.variants.filter(v => {
                        if (!v.name) return false;
                        const cash = parseFloat(v.priceCash);
                        const points = parseFloat(v.pricePoints);
                        return (cash > 0) || (points > 0);
                    }).map(v => ({
                        id: v.id,
                        variant_id: v.variant_id,
                        name: v.name,
                        size: v.size,
                        color: v.color,
                        image_url: v.image_url,
                        stock: v.stock,
                        weightOz: v.weightOz,
                        unitCost: v.unitCost,
                        priceCash: v.priceCash,
                        pricePoints: v.pricePoints,
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
                variants: [{
                    id: '',
                    variant_id: '',
                    name: '',
                    priceCash: '',
                    pricePoints: '',
                    size: '',
                    color: '',
                    image_url: '',
                    stock: '',
                    weightOz: '',
                    unitCost: '',
                    sku: ''
                }],
                shippingOptions: [{ id: '', country: '', cost: '', costPoints: '' }],
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
        const formattedVariants = (product.variants || []).map(v => {
            const raw = v as any;
            // Derive cash price: new field first, then legacy fallbacks. Only keep if > 0.
            const cashVal = raw.price_cash ?? raw.price_balance ?? raw.price_balance_full ?? raw.price;
            const pointsVal = raw.price_points ?? raw.price_points_full ?? raw.pointsPrice;
            const cashNum = Number(cashVal);
            const pointsNum = Number(pointsVal);

            return {
                id: v.id,
                variant_id: v.variant_id,
                name: v.name,
                priceCash: cashNum > 0 ? cashNum.toString() : '',
                pricePoints: pointsNum > 0 ? pointsNum.toString() : '',
                size: v.size || '',
                color: v.color || '',
                image_url: v.image_url || '',
                stock: v.stock?.toString() || '',
                weightOz: (v as any).weightOz?.toString() || '',
                unitCost: (v as any).unitCost != null ? String((v as any).unitCost) : '',
                sku: (v as any).sku || '',
            };
        });

        setFormData({
            name: product.name,
            description: product.description,
            image_url: product.image_url || '',
            thumbnail_url: product.thumbnail_url || '',
            category: product.category || '',
            variants: formattedVariants.length > 0 ? formattedVariants : [{
                id: '',
                variant_id: '',
                name: '',
                priceCash: '',
                pricePoints: '',
                size: '',
                color: '',
                image_url: '',
                stock: '',
                weightOz: '',
                unitCost: '',
                sku: ''
            }],
            shippingOptions: (product.shippingOptions || []).map(s => ({
                id: s.id,
                country: s.country,
                cost: s.cost.toString(),
                costPoints: s.costPoints?.toString() || '',
            })) || [{ id: '', country: '', cost: '', costPoints: '' }],
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
            variants: [{
                id: '',
                variant_id: '',
                name: '',
                priceCash: '',
                pricePoints: '',
                size: '',
                color: '',
                image_url: '',
                stock: '',
                weightOz: '',
                unitCost: '',
                sku: ''
            }],
            shippingOptions: [{ id: '', country: '', cost: '', costPoints: '' }],
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
                                        <ImageField
                                            label="Thumbnail"
                                            value={formData.thumbnail_url}
                                            onChange={(url) => setFormData({ ...formData, thumbnail_url: url })}
                                            onUpload={uploadImage}
                                            uploadingKey="thumbnail"
                                            uploading={uploading}
                                            setUploading={setUploading}
                                        />
                                        <ImageField
                                            label="Image"
                                            value={formData.image_url}
                                            onChange={(url) => setFormData({ ...formData, image_url: url })}
                                            onUpload={uploadImage}
                                            uploadingKey="image"
                                            uploading={uploading}
                                            setUploading={setUploading}
                                        />
                                        {uploadError && (
                                            <p className="col-span-2 text-sm text-hackclub-red font-medium">{uploadError}</p>
                                        )}
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
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Variant Name"
                                                            value={variant.name}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].name = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="col-span-2 px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="space-y-1">
                                                            <label className="block text-xs font-bold text-hackclub-slate">Cash price (USD)</label>
                                                            <input
                                                                type="number"
                                                                placeholder="0.00"
                                                                step="0.01"
                                                                value={variant.priceCash}
                                                                onChange={(e) => {
                                                                    const newVariants = [...formData.variants];
                                                                    newVariants[idx].priceCash = e.target.value;
                                                                    setFormData({ ...formData, variants: newVariants });
                                                                }}
                                                                className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="block text-xs font-bold text-hackclub-slate">Points price</label>
                                                            <input
                                                                type="number"
                                                                placeholder="0"
                                                                step="1"
                                                                value={variant.pricePoints}
                                                                onChange={(e) => {
                                                                    const newVariants = [...formData.variants];
                                                                    newVariants[idx].pricePoints = e.target.value;
                                                                    setFormData({ ...formData, variants: newVariants });
                                                                }}
                                                                className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                            />
                                                        </div>
                                                        <p className="col-span-2 text-xs text-hackclub-muted font-medium">
                                                            Set cash for adult shoppers, points for Hack Clubbers — at least one.
                                                        </p>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
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
                                                        <div className="col-span-2">
                                                            <ImageField
                                                                label="Variant Image"
                                                                value={variant.image_url}
                                                                onChange={(url) => {
                                                                    const newVariants = [...formData.variants];
                                                                    newVariants[idx].image_url = url;
                                                                    setFormData({ ...formData, variants: newVariants });
                                                                }}
                                                                onUpload={uploadImage}
                                                                uploadingKey={`variant-${idx}`}
                                                                uploading={uploading}
                                                                setUploading={setUploading}
                                                                compact
                                                            />
                                                        </div>
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
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            placeholder="Weight (oz)"
                                                            title="Shipping weight per unit in ounces — used for live shipping rates. Leave blank to use the default."
                                                            value={variant.weightOz}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].weightOz = e.target.value;
                                                                setFormData({ ...formData, variants: newVariants });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min={0}
                                                            placeholder="Unit cost ($)"
                                                            title="What we pay per unit (USD) — drives inventory valuation and cost of goods. Recording a stock receipt in Finance updates this to a weighted average. Leave blank if unknown."
                                                            value={variant.unitCost}
                                                            onChange={(e) => {
                                                                const newVariants = [...formData.variants];
                                                                newVariants[idx].unitCost = e.target.value;
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
                                                    {/* Barcode SKU: managed in the Labels tool (keeps the sku index authoritative). */}
                                                    <div className="mt-2 flex items-center gap-2 text-sm">
                                                        <span className="text-xs font-black uppercase text-hackclub-muted">Barcode SKU</span>
                                                        {variant.sku ? (
                                                            <span className="font-mono font-bold text-hackclub-purple">{variant.sku}</span>
                                                        ) : (
                                                            <span className="text-hackclub-muted font-medium">{editingId && variant.variant_id ? 'none yet' : 'save the product first'}</span>
                                                        )}
                                                        {editingId && variant.variant_id && (
                                                            <a
                                                                href={`/admin/labels?variant=${encodeURIComponent(variant.variant_id)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-hackclub-purple border-2 border-hackclub-purple/30 hover:bg-hackclub-purple hover:text-white transition-colors"
                                                            >
                                                                {variant.sku ? 'Print / edit label' : 'Generate label'}
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    variants: [...formData.variants, {
                                                        id: '',
                                                        variant_id: '',
                                                        name: '',
                                                        priceCash: '',
                                                        pricePoints: '',
                                                        size: '',
                                                        color: '',
                                                        image_url: '',
                                                        stock: '',
                                                        weightOz: '',
                                                        unitCost: '',
                                                        sku: ''
                                                    }]
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
                                                    <div className="grid grid-cols-3 gap-2">
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
                                                            placeholder="Cost ($)"
                                                            step="0.01"
                                                            value={shipping.cost}
                                                            onChange={(e) => {
                                                                const newShipping = [...formData.shippingOptions];
                                                                newShipping[idx].cost = e.target.value;
                                                                setFormData({ ...formData, shippingOptions: newShipping });
                                                            }}
                                                            className="px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Cost (pts)"
                                                            step="1"
                                                            value={shipping.costPoints || ''}
                                                            onChange={(e) => {
                                                                const newShipping = [...formData.shippingOptions];
                                                                newShipping[idx].costPoints = e.target.value;
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
                                                    shippingOptions: [...formData.shippingOptions, { id: '', country: '', cost: '', costPoints: '' }]
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
