'use client';

import { useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { PointsContext } from '../../context/PointsContext';
import { ShippingOption, CheckoutField } from '../../types/Admin';
import { ShippingAddress } from '../../types/Order';
import { COUNTRIES, EMPTY_ADDRESS, validateAddress } from '../../lib/address';
import { formatPoints, formatCash } from '../../lib/paymentUtils';
import { usePathway } from '../../lib/usePathway';

type CheckoutValue = string | ShippingAddress;

const Checkout = () => {
    const { status } = useSession();
    const { isStudent } = usePathway();
    const cartContext = useContext(CartContext);
    const pointsContext = useContext(PointsContext);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedShipping, setSelectedShipping] = useState<ShippingOption | null>(null);
    const [checkoutData, setCheckoutData] = useState<Record<string, CheckoutValue>>({});
    const [guestEmail, setGuestEmail] = useState('');
    const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
    const [checkoutFields, setCheckoutFields] = useState<CheckoutField[]>([]);
    const [loadingCheckoutInfo, setLoadingCheckoutInfo] = useState(true);
    const router = useRouter();

    useEffect(() => {
        if (cartContext?.cart && cartContext.cart.length > 0) {
            const loadCheckoutInfo = async () => {
                try {
                    const cart = cartContext.cart;
                    if (!cart || cart.length === 0) return;
                    const firstItem = cart[0];
                    const res = await fetch(`/api/products/${firstItem.id}`);
                    const data = await res.json();

                    if (data.result?.sync_product) {
                        const product = data.result.sync_product;

                        const shipping = (product.shippingOptions && product.shippingOptions.length > 0)
                            ? product.shippingOptions.map((s: any, idx: number) => ({
                                id: s.id || `ship_${Date.now()}_${idx}`,
                                country: s.country,
                                cost: parseFloat(s.cost) || 0,
                                costPoints: s.costPoints || 0,
                            }))
                            : [];
                        console.log('[Checkout] Loaded shipping options:', shipping);
                        setShippingOptions(shipping);
                        setSelectedShipping(shipping.length > 0 ? shipping[0] : null);

                        const fields = (product.checkoutFields && product.checkoutFields.length > 0)
                            ? product.checkoutFields.map((f: any, idx: number) => ({
                                id: f.id || `field_${Date.now()}_${idx}`,
                                name: f.name,
                                label: f.label,
                                type: f.type,
                                required: f.required,
                            }))
                            : [
                                { id: `field_${Date.now()}_1`, name: 'name', label: 'Full Name', type: 'text', required: true },
                                { id: `field_${Date.now()}_2`, name: 'email', label: 'Email', type: 'email', required: true },
                                { id: `field_${Date.now()}_3`, name: 'address', label: 'Shipping Address', type: 'address', required: true },
                            ];
                        setCheckoutFields(fields);
                    }
                } catch (err) {
                    console.error('Failed to load checkout info:', err);
                    setShippingOptions([]);
                    setSelectedShipping(null);
                } finally {
                    setLoadingCheckoutInfo(false);
                }
            };
            loadCheckoutInfo();
        }
    }, [cartContext?.cart]);

    // Wait for auth to resolve before committing to a pathway, so a logged-in
    // student never briefly sees the guest (cash) checkout.
    if (status === 'loading' || loadingCheckoutInfo) {
        return (
            <div className="bg-hackclub-smoke min-h-screen flex items-center justify-center">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (!cartContext || cartContext.cart === null) return null;

    const { cart, clearCart } = cartContext;

    // Student (points) totals.
    const itemsPoints = cart.reduce((total, item) => total + (item.price_points || 0) * item.quantity, 0);
    const shippingPointsCost = selectedShipping?.costPoints || 0;
    const requiredPoints = itemsPoints + shippingPointsCost;

    // Guest (cash) totals.
    const itemsCash = cart.reduce((total, item) => total + (item.price_cash || 0) * item.quantity, 0);
    const shippingCash = selectedShipping?.cost || 0;
    const cashTotal = itemsCash + shippingCash;

    const pointsBalance = pointsContext?.balance || 0;
    const hasEnoughPoints = pointsBalance >= requiredPoints;
    const remainingPointsNeeded = Math.max(0, requiredPoints - pointsBalance);
    const shippingSelected = shippingOptions.length === 0 || !!selectedShipping;
    const canCheckout = isStudent
        ? hasEnoughPoints && cart.length > 0 && shippingSelected
        : cashTotal > 0 && cart.length > 0 && shippingSelected;

    const validateCheckoutFields = (): boolean => {
        for (const field of checkoutFields) {
            const value = checkoutData[field.name];

            if (field.type === 'address') {
                const errors = validateAddress(value as ShippingAddress | undefined);
                if (field.required && errors.length > 0) {
                    setError(errors[0]);
                    return false;
                }
                continue;
            }

            if (field.required && (!value || typeof value !== 'string' || !value.trim())) {
                setError(`${field.label} is required`);
                return false;
            }
            if (field.name === 'email') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value as string)) {
                    setError('Please enter a valid email address');
                    return false;
                }
            }
        }
        return true;
    };

    const updateAddressField = (fieldName: string, key: keyof ShippingAddress, val: string) => {
        const current = (checkoutData[fieldName] as ShippingAddress) || EMPTY_ADDRESS;
        setCheckoutData({ ...checkoutData, [fieldName]: { ...current, [key]: val } });
    };

    const itemsPayload = () => cart.map((item) => ({
        id: String(item.id),
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        variant_id: item.variant_id,
    }));

    // Student path: pay with points via /api/orders.
    const handleStudentCheckout = async () => {
        if (!hasEnoughPoints) {
            setError('Not enough points to cover the item requirements.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const idempotencyKey = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const response = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsPayload(),
                    pointsRequired: requiredPoints,
                    shippingCountry: selectedShipping?.country,
                    shippingPointsCost,
                    checkoutData,
                    idempotencyKey,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || 'Failed to process order');
                setLoading(false);
                return;
            }
            if (pointsContext?.refreshPoints) {
                await pointsContext.refreshPoints();
            }
            clearCart();
            router.push('/thank-you');
        } catch {
            setError('Failed to connect to server. Please try again.');
            setLoading(false);
        }
    };

    // Guest path: pay real money via Stripe Checkout.
    const handleGuestCheckout = async () => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(guestEmail)) {
            setError('Please enter a valid email for your receipt.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/checkout/stripe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsPayload(),
                    email: guestEmail,
                    shippingCountry: selectedShipping?.country,
                    checkoutData,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) {
                setError(data.error || 'Failed to start checkout');
                setLoading(false);
                return;
            }
            // Hand off to Stripe's hosted checkout. The cart is cleared only after
            // the webhook confirms payment (on the thank-you page), so a cancelled
            // payment keeps the cart intact.
            window.location.href = data.url;
        } catch {
            setError('Failed to connect to server. Please try again.');
            setLoading(false);
        }
    };

    const handleCheckout = async () => {
        if (shippingOptions.length > 0 && !selectedShipping) {
            setError('Please select a shipping option');
            return;
        }
        if (!validateCheckoutFields()) {
            return;
        }
        if (isStudent) {
            await handleStudentCheckout();
        } else {
            await handleGuestCheckout();
        }
    };

    return (
        <div className="bg-hackclub-smoke min-h-screen text-hackclub-dark py-12 px-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.35, type: 'spring', stiffness: 180, damping: 18 }}
                className="w-full max-w-6xl mx-auto bg-white text-hackclub-dark rounded-3xl shadow-2xl border border-hackclub-smoke overflow-hidden"
            >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
                    {/* LEFT COLUMN */}
                    <div className="space-y-6">
                        <div>
                            <h1 className="text-3xl font-black mb-2 text-hackclub-red">Checkout</h1>
                            <h2 className="text-lg font-bold text-hackclub-slate">
                                {isStudent ? 'Pay with your points.' : 'Pay securely by card.'}
                            </h2>
                        </div>

                        {cart.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke">
                                <label className="block font-bold text-hackclub-dark mb-3">Shipping Country</label>
                                {shippingOptions.length === 0 ? (
                                    <div className="w-full px-4 py-3 text-center text-hackclub-slate font-bold bg-hackclub-smoke/50 border-2 border-hackclub-smoke rounded-lg">
                                        Free shipping
                                    </div>
                                ) : (
                                    <select
                                        value={selectedShipping?.id || shippingOptions[0]?.id || ''}
                                        onChange={(e) => {
                                            const option = shippingOptions.find((s) => s.id === e.target.value);
                                            if (option) setSelectedShipping(option);
                                        }}
                                        className="w-full px-4 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                    >
                                        {shippingOptions.map((option, idx) => (
                                            <option key={option.id || `ship_${idx}`} value={option.id || `ship_${idx}`}>
                                                {option.country} - {isStudent ? formatPoints(option.costPoints || 0) : formatCash(option.cost || 0)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </motion.div>
                        )}

                        {cart.length > 0 && checkoutFields.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-3">
                                <p className="font-bold text-hackclub-dark">Shipping Information</p>
                                {checkoutFields.map((field, idx) => {
                                    const inputClass = "w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium";
                                    if (field.type === 'address') {
                                        const addr = (checkoutData[field.name] as ShippingAddress) || EMPTY_ADDRESS;
                                        return (
                                            <div key={field.id || `field_${idx}`} className="space-y-2">
                                                <label className="block text-sm font-bold text-hackclub-slate mb-1">
                                                    {field.label}
                                                    {field.required && <span className="text-hackclub-red">*</span>}
                                                </label>
                                                <input className={inputClass} placeholder="Full name" autoComplete="name"
                                                    value={addr.name} onChange={(e) => updateAddressField(field.name, 'name', e.target.value)} />
                                                <input className={inputClass} placeholder="Address line 1" autoComplete="address-line1"
                                                    value={addr.line1} onChange={(e) => updateAddressField(field.name, 'line1', e.target.value)} />
                                                <input className={inputClass} placeholder="Address line 2 (optional)" autoComplete="address-line2"
                                                    value={addr.line2 || ''} onChange={(e) => updateAddressField(field.name, 'line2', e.target.value)} />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className={inputClass} placeholder="City" autoComplete="address-level2"
                                                        value={addr.city} onChange={(e) => updateAddressField(field.name, 'city', e.target.value)} />
                                                    <input className={inputClass} placeholder="State / Province" autoComplete="address-level1"
                                                        value={addr.state} onChange={(e) => updateAddressField(field.name, 'state', e.target.value)} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className={inputClass} placeholder="Postal code" autoComplete="postal-code"
                                                        value={addr.postal_code} onChange={(e) => updateAddressField(field.name, 'postal_code', e.target.value)} />
                                                    <select className={inputClass} autoComplete="country"
                                                        value={addr.country} onChange={(e) => updateAddressField(field.name, 'country', e.target.value)}>
                                                        {COUNTRIES.map((c) => (
                                                            <option key={c.code} value={c.code}>{c.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={field.id || `field_${idx}`}>
                                            <label className="block text-sm font-bold text-hackclub-slate mb-1">
                                                {field.label}
                                                {field.required && <span className="text-hackclub-red">*</span>}
                                            </label>
                                            {field.type === 'textarea' ? (
                                                <textarea
                                                    placeholder={field.label}
                                                    value={(checkoutData[field.name] as string) || ''}
                                                    onChange={(e) => setCheckoutData({ ...checkoutData, [field.name]: e.target.value })}
                                                    className={inputClass}
                                                    rows={3}
                                                />
                                            ) : (
                                                <input
                                                    type={field.type}
                                                    placeholder={field.label}
                                                    value={(checkoutData[field.name] as string) || ''}
                                                    onChange={(e) => setCheckoutData({ ...checkoutData, [field.name]: e.target.value })}
                                                    className={inputClass}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </motion.div>
                        )}

                        {!isStudent && cart.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-2">
                                <label className="block font-bold text-hackclub-dark">Email for receipt</label>
                                <input
                                    type="email"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    value={guestEmail}
                                    onChange={(e) => setGuestEmail(e.target.value)}
                                    className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                                />
                                <p className="text-xs text-hackclub-muted">We&apos;ll send your order confirmation here. Payment is processed securely by Stripe.</p>
                            </motion.div>
                        )}
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="space-y-6">
                        {cart.length > 0 && (
                            <div className="divide-y divide-hackclub-smoke border-b-2 border-hackclub-smoke pb-6">
                                <AnimatePresence initial={false}>
                                    {cart.map((item) => (
                                        <motion.div key={item.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }} className="flex items-center gap-4 py-4">
                                            {item.thumbnail_url && <Image src={item.thumbnail_url} alt={item.name} width={56} height={56} className="rounded-xl bg-hackclub-smoke object-cover" />}
                                            <div className="flex-1">
                                                <div className="font-bold text-hackclub-dark">{item.name}</div>
                                                <div className="text-hackclub-muted text-sm">Qty: {item.quantity || 1}</div>
                                            </div>
                                            <div className="font-black text-hackclub-red text-lg">
                                                {isStudent
                                                    ? formatPoints((item.price_points || 0) * (item.quantity || 1))
                                                    : formatCash((item.price_cash || 0) * (item.quantity || 1))}
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}

                        <div className="bg-hackclub-smoke/30 rounded-2xl p-6 border-2 border-hackclub-smoke space-y-2">
                            <div className="flex justify-between items-center text-hackclub-slate">
                                <span>Items:</span>
                                <span>{isStudent ? formatPoints(itemsPoints) : formatCash(itemsCash)}</span>
                            </div>
                            {shippingOptions.length > 0 && (
                                <div className="flex justify-between items-center text-hackclub-slate">
                                    <span>Shipping ({selectedShipping?.country}):</span>
                                    <span>{isStudent ? formatPoints(shippingPointsCost) : formatCash(shippingCash)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
                                <span>{isStudent ? 'Points Required:' : 'Total:'}</span>
                                <span className="text-hackclub-dark">{isStudent ? formatPoints(requiredPoints) : formatCash(cashTotal)}</span>
                            </div>
                            {isStudent && (
                                <div className="flex justify-between items-center text-sm text-hackclub-slate">
                                    <span>Your points:</span>
                                    <span>{formatPoints(pointsBalance)}</span>
                                </div>
                            )}
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-3 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl">
                                    <p className="text-hackclub-red font-bold text-sm">{error}</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <motion.button
                            whileHover={canCheckout ? { scale: 1.03 } : {}}
                            whileTap={canCheckout ? { scale: 0.97 } : {}}
                            className={`w-full font-black text-lg py-3 rounded-full transition-all shadow-lg ${canCheckout ? 'bg-hackclub-red hover:bg-hackclub-orange text-white hover:shadow-xl' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                }`}
                            onClick={canCheckout ? handleCheckout : undefined}
                            disabled={loading || !canCheckout}
                        >
                            <AnimatePresence mode="wait" initial={false}>
                                {loading ? (
                                    <motion.span key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        <span className="inline-block animate-pulse">{isStudent ? 'Processing…' : 'Redirecting to payment…'}</span>
                                    </motion.span>
                                ) : canCheckout ? (
                                    <motion.span key="checkout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        {isStudent ? 'Checkout →' : 'Pay with card →'}
                                    </motion.span>
                                ) : (
                                    <motion.span key="insufficient" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        {isStudent
                                            ? `Need ${remainingPointsNeeded} more points`
                                            : (cart.length === 0 ? 'Cart is empty' : 'Not available for card purchase')}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Checkout;
