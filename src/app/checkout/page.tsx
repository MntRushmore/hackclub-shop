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
import { EMPTY_ADDRESS, validateAddress } from '../../lib/address';
import { formatPoints, formatCash, usdToPoints, pointsToUsd } from '../../lib/paymentUtils';
import { usePathway } from '../../lib/usePathway';
import { DONATION_FUNDS, DEFAULT_FUND_ID } from '../../lib/donation';
import LiveShippingRates, { SelectedRate } from './LiveShippingRates';

type CheckoutValue = string | ShippingAddress;

const Checkout = () => {
    const { data: session, status } = useSession();
    const { isStudent: isStudentPathway, isAdminMode } = usePathway();
    // Admins (full-catalog mode) choose how to pay per order. Everyone else is
    // fixed: students pay points, guests pay by card via Stripe.
    const [adminPayMode, setAdminPayMode] = useState<'points' | 'card'>('points');
    // The single switch the rest of checkout keys off: true = points checkout,
    // false = Stripe card checkout.
    const payWithPoints = isAdminMode ? adminPayMode === 'points' : isStudentPathway;
    const cartContext = useContext(CartContext);
    const pointsContext = useContext(PointsContext);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedShipping, setSelectedShipping] = useState<ShippingOption | null>(null);
    // Live EasyPost rate chosen by guests (when configured). Students keep the
    // flat points-shipping flow below.
    const [selectedRate, setSelectedRate] = useState<SelectedRate | null>(null);
    const [checkoutData, setCheckoutData] = useState<Record<string, CheckoutValue>>({});
    const [guestEmail, setGuestEmail] = useState('');
    // Inline email validation: only surface the error once the parent has left
    // the field (blur), so we don't nag mid-typing, but they learn it's wrong
    // before they hit Pay instead of at the worst possible moment.
    const [emailTouched, setEmailTouched] = useState(false);
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail);
    const showEmailError = emailTouched && guestEmail.length > 0 && !emailValid;

    // Prefill the receipt email from the signed-in session, but only once and
    // only if the shopper hasn't typed their own. Signed-in parents now pay by
    // card too, so this saves them retyping an address we already know.
    const sessionEmail = session?.user?.email;
    useEffect(() => {
        if (sessionEmail) {
            setGuestEmail((prev) => (prev ? prev : sessionEmail));
        }
    }, [sessionEmail]);
    const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
    const [checkoutFields, setCheckoutFields] = useState<CheckoutField[]>([]);
    const [loadingCheckoutInfo, setLoadingCheckoutInfo] = useState(true);
    // Donation pivot: which cart products are donation tiers (id → tier config),
    // so the fund picker / dedication UI only appears on donation checkouts and
    // the summary can show the tax-deductible estimate. Server re-derives all of
    // this from the catalog — these values are display-only.
    const [donationTiers, setDonationTiers] = useState<Record<string, { tier: string; fmvCents: number }>>({});
    const [fundId, setFundId] = useState<string>(DEFAULT_FUND_ID);
    const [dedication, setDedication] = useState('');
    const [donorName, setDonorName] = useState('');
    const [donorAnonymous, setDonorAnonymous] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // One catalog read to flag donation-tier cart items. Failure just means
        // the donation extras don't render — checkout still works.
        fetch('/api/products')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                const map: Record<string, { tier: string; fmvCents: number }> = {};
                for (const p of data?.result || []) {
                    if (p.donation) map[String(p.id)] = { tier: p.donation.tier, fmvCents: p.donation.fmvCents || 0 };
                }
                setDonationTiers(map);
            })
            .catch(() => {});
    }, []);

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

                        const rawFields: CheckoutField[] = (product.checkoutFields && product.checkoutFields.length > 0)
                            ? product.checkoutFields.map((f: any, idx: number) => ({
                                id: f.id || `field_${Date.now()}_${idx}`,
                                name: f.name,
                                label: f.label,
                                type: f.type,
                                required: f.required,
                            }))
                            // Default: a single address block. The recipient NAME lives inside
                            // the address; EMAIL is collected once via the dedicated receipt-email
                            // input (guest path) — so we no longer add standalone name/email fields
                            // that made the shopper type the same thing two or three times.
                            : [
                                { id: `field_${Date.now()}_addr`, name: 'address', label: 'Shipping address', type: 'address', required: true },
                            ];
                        // Strip standalone name/email fields: name is in the address block and
                        // email is the receipt-email input, so these would be duplicates. (A
                        // product's own custom non-name/email fields are kept as-is.)
                        const fields = rawFields.filter(
                            (f) => !(f.type !== 'address' && (f.name === 'name' || f.name === 'email')),
                        );
                        setCheckoutFields(fields);

                        // Seed each address field with EMPTY_ADDRESS so the address
                        // object exists immediately. Without this, checkoutData had no
                        // address until the user touched a sub-field, so the live-rate
                        // lookup reported "enter your address" until the country select
                        // was toggled. (Country itself is intentionally blank — the
                        // customer must pick it; see EMPTY_ADDRESS.)
                        setCheckoutData((prev) => {
                            const next = { ...prev };
                            let changed = false;
                            for (const f of fields) {
                                if (f.type === 'address' && next[f.name] === undefined) {
                                    next[f.name] = { ...EMPTY_ADDRESS };
                                    changed = true;
                                }
                            }
                            return changed ? next : prev;
                        });
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

    // Student (points) totals. For an admin paying points, a cash-only item
    // (no points price) is charged at 1 point = $1 — must mirror the server.
    const itemsPoints = cart.reduce((total, item) => {
        const pts = item.price_points || (isAdminMode ? usdToPoints(item.price_cash || 0) : 0);
        return total + pts * item.quantity;
    }, 0);
    // Points shipping now uses the SAME live EasyPost rate as the cash path,
    // converted to points at 1pt=$1. (The server re-validates the rate and
    // recomputes this — the client number is never trusted.)
    const shippingPointsCost = usdToPoints(selectedRate?.cost ?? 0);
    const requiredPoints = itemsPoints + shippingPointsCost;

    // Guest (cash) totals. Guests now choose a live shipping rate, so the shipping
    // amount comes from selectedRate (falls back to 0 until one is chosen). For an
    // admin paying by card, a points-only item (no cash price) is charged at 1pt = $1.
    const itemsCash = cart.reduce((total, item) => {
        const cash = item.price_cash || (isAdminMode ? pointsToUsd(item.price_points || 0) : 0);
        return total + cash * item.quantity;
    }, 0);
    const shippingCash = selectedRate?.cost ?? 0;
    const cashTotal = itemsCash + shippingCash;

    // Donation-tier presence + the display-only deductible estimate (donation
    // minus each gift's fair market value; the server computes the real number).
    const hasDonation = cart.some((item) => donationTiers[String(item.id)]);
    const deductibleEstimate = cart.reduce((total, item) => {
        const tier = donationTiers[String(item.id)];
        if (!tier || !item.price_cash) return total;
        return total + Math.max(0, item.price_cash - tier.fmvCents / 100) * (item.quantity || 1);
    }, 0);

    const pointsBalance = pointsContext?.balance || 0;
    const hasEnoughPoints = pointsBalance >= requiredPoints;
    const remainingPointsNeeded = Math.max(0, requiredPoints - pointsBalance);
    // Both pathways now require a live shipping rate before checkout.
    const canCheckout = payWithPoints
        ? hasEnoughPoints && cart.length > 0 && !!selectedRate
        : itemsCash > 0 && cart.length > 0 && !!selectedRate;

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

    // Browser autofill sets input.value in the DOM but does NOT reliably fire
    // React's synthetic onChange — so a one-click autofill could leave checkoutData
    // stale and the live-rate lookup would never run (the user had to retype or
    // flip the country to force it). This sweep reads the actual DOM values of the
    // address fields and syncs any that React missed. Bound to onInput (which
    // autofill DOES fire) and onBlur as a backstop.
    const syncAutofill = (fieldName: string, form: HTMLFormElement | null) => {
        if (!form) return;
        const read = (name: string) =>
            (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
        const current = (checkoutData[fieldName] as ShippingAddress) || EMPTY_ADDRESS;
        const next: ShippingAddress = {
            ...current,
            name: read('name') || current.name,
            line1: read('address-line1') || current.line1,
            line2: read('address-line2') || current.line2,
            city: read('city') || current.city,
            state: read('state') || current.state,
            postal_code: read('postal_code') || current.postal_code,
            country: read('country') || current.country || 'US',
        };
        // Only update if something actually changed, to avoid a render loop.
        const changed = (Object.keys(next) as (keyof ShippingAddress)[]).some((k) => next[k] !== current[k]);
        if (changed) setCheckoutData({ ...checkoutData, [fieldName]: next });
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
                    // Send the chosen live rate; the server re-validates it and
                    // recomputes the points shipping cost (1pt=$1). The client's
                    // shippingPointsCost is sent only for the mismatch error message.
                    shippingPointsCost,
                    ...(selectedRate?.shipmentId
                        ? { selectedRate: { rateId: selectedRate.rateId, shipmentId: selectedRate.shipmentId, quoteId: selectedRate.quoteId } }
                        : {}),
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

    // Guest path: pay with a card via Stripe Checkout. Stripe Tax computes sales
    // tax (and collects the billing/shipping address) on its hosted page.
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
                    ...(selectedRate?.shipmentId
                        ? { selectedRate: { rateId: selectedRate.rateId, shipmentId: selectedRate.shipmentId, quoteId: selectedRate.quoteId } }
                        : {}),
                    // Donor fields — the server ignores these unless the verified
                    // cart actually contains donation tiers.
                    ...(hasDonation
                        ? { donation: { fundId, dedication, displayName: donorName, anonymous: donorAnonymous } }
                        : {}),
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) {
                setError(data.error || 'Failed to start checkout');
                setLoading(false);
                return;
            }
            // Hand off to Stripe's hosted Checkout. The cart is cleared only once
            // payment is confirmed (on the thank-you page, which polls the
            // webhook-settled status), so an abandoned payment keeps the cart.
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
        if (payWithPoints) {
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
                className="w-full max-w-6xl mx-auto bg-white text-hackclub-dark rounded-2xl sm:rounded-3xl shadow-2xl border border-hackclub-smoke overflow-hidden"
            >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 p-5 sm:p-8">
                    {/* LEFT COLUMN */}
                    <div className="space-y-6">
                        <div>
                            <h1 className="text-3xl font-black mb-2 text-hackclub-red">Checkout</h1>
                            <h2 className="text-lg font-bold text-hackclub-slate">
                                {payWithPoints
                                    ? 'Pay with your points.'
                                    : hasDonation
                                        ? 'Complete your donation with a secure card payment.'
                                        : 'Complete your order with a secure card payment.'}
                            </h2>
                        </div>

                        {/* Admin (full-catalog mode): choose how to pay this order. */}
                        {isAdminMode && cart.length > 0 && (
                            <div className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke">
                                <label className="block font-bold text-hackclub-dark mb-3">Payment method (admin)</label>
                                <div className="flex gap-2">
                                    {(['points', 'card'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setAdminPayMode(m)}
                                            className={`flex-1 px-4 py-2 rounded-full font-bold text-sm transition-colors border-2 ${
                                                adminPayMode === m
                                                    ? 'bg-hackclub-red border-hackclub-red text-white'
                                                    : 'bg-white border-hackclub-smoke text-hackclub-slate hover:border-hackclub-slate'
                                            }`}
                                        >
                                            {m === 'points' ? 'Pay with points' : 'Pay with card'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Both pathways now use live EasyPost rates (the picker is
                            rendered below, after the address fields). Points orders
                            pay the rate converted to points at 1pt = $1. */}

                        {/* Email first (guest/card path) — collected once here for the
                            receipt + confirmation; not re-asked anywhere else on this page. */}
                        {!payWithPoints && cart.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-2">
                                <label htmlFor="guest-email" className="block font-bold text-hackclub-dark">Email</label>
                                <input
                                    id="guest-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    value={guestEmail}
                                    onChange={(e) => setGuestEmail(e.target.value)}
                                    onBlur={() => setEmailTouched(true)}
                                    aria-invalid={showEmailError}
                                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none focus-visible:ring-2 text-hackclub-dark font-medium transition-colors ${showEmailError ? 'border-hackclub-red focus-visible:border-hackclub-red focus-visible:ring-hackclub-red/40' : 'border-hackclub-smoke focus-visible:border-hackclub-red focus-visible:ring-hackclub-red/40'}`}
                                />
                                {showEmailError ? (
                                    <p className="text-xs text-hackclub-red font-bold">Please enter a valid email so we can send your confirmation.</p>
                                ) : (
                                    <p className="text-xs text-hackclub-muted">For your order confirmation &amp; tracking. You&apos;ll only enter your card on Stripe&apos;s secure page, so your shipping address below is passed along and you won&apos;t retype it.</p>
                                )}
                            </motion.div>
                        )}

                        {/* Donation details — only for carts containing donation tiers.
                            Fund choice + optional dedication and donor-wall name. */}
                        {!payWithPoints && cart.length > 0 && hasDonation && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-3">
                                <p className="font-bold text-hackclub-dark">What matters most to you?</p>
                                <p className="text-xs text-hackclub-muted -mt-1">
                                    This tells us what you care about. Every dollar goes to Hack Club&apos;s
                                    programs for teenagers, wherever it helps them most.
                                </p>
                                <div className="space-y-2">
                                    {DONATION_FUNDS.map((fund) => (
                                        <label
                                            key={fund.id}
                                            className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                                                fundId === fund.id
                                                    ? 'border-hackclub-red bg-white'
                                                    : 'border-hackclub-smoke bg-white/60 hover:border-hackclub-slate'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="donation-fund"
                                                value={fund.id}
                                                checked={fundId === fund.id}
                                                onChange={() => setFundId(fund.id)}
                                                className="mt-1 w-4 h-4 accent-hackclub-red"
                                            />
                                            <span>
                                                <span className="block font-bold text-hackclub-dark text-sm">{fund.name}</span>
                                                <span className="block text-xs text-hackclub-muted leading-snug">{fund.description}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                <div>
                                    <label htmlFor="donation-dedication" className="block text-sm font-bold text-hackclub-slate mb-1">Dedication (optional)</label>
                                    <input
                                        id="donation-dedication"
                                        type="text"
                                        maxLength={140}
                                        placeholder="In honor of Maya"
                                        value={dedication}
                                        onChange={(e) => setDedication(e.target.value)}
                                        className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 text-hackclub-dark font-medium"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="donation-donor-name" className="block text-sm font-bold text-hackclub-slate mb-1">Name on the donor wall (optional)</label>
                                    <input
                                        id="donation-donor-name"
                                        type="text"
                                        maxLength={60}
                                        placeholder="The Chen Family"
                                        value={donorName}
                                        onChange={(e) => setDonorName(e.target.value)}
                                        disabled={donorAnonymous}
                                        className={`w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 text-hackclub-dark font-medium ${donorAnonymous ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={donorAnonymous}
                                        onChange={(e) => setDonorAnonymous(e.target.checked)}
                                        className="w-4 h-4 accent-hackclub-red"
                                    />
                                    <span className="text-sm font-bold text-hackclub-slate">Keep my donation anonymous</span>
                                </label>
                            </motion.div>
                        )}

                        {cart.length > 0 && checkoutFields.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-3">
                                <p className="font-bold text-hackclub-dark">Shipping address</p>
                                {checkoutFields.map((field, idx) => {
                                    const inputClass = "w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 text-hackclub-dark font-medium";
                                    if (field.type === 'address') {
                                        const addr = (checkoutData[field.name] as ShippingAddress) || EMPTY_ADDRESS;
                                        // Wrap in a <form> so (a) browser autofill recognises it as one
                                        // address group and fills all fields at once, and (b) the
                                        // autofill sweep can read every field's DOM value by name even
                                        // when React's onChange didn't fire for some of them.
                                        const onSweep = (e: React.SyntheticEvent) =>
                                            syncAutofill(field.name, (e.currentTarget as HTMLElement).closest('form'));
                                        return (
                                            <form key={field.id || `field_${idx}`} className="space-y-2" onInput={onSweep} onBlur={onSweep} autoComplete="on">
                                                <label className="block text-sm font-bold text-hackclub-slate mb-1">
                                                    {field.label}
                                                    {field.required && <span className="text-hackclub-red">*</span>}
                                                </label>
                                                <input className={inputClass} name="name" placeholder="Full name" autoComplete="shipping name"
                                                    value={addr.name} onChange={(e) => updateAddressField(field.name, 'name', e.target.value)} />
                                                <input className={inputClass} name="address-line1" placeholder="Address line 1" autoComplete="shipping address-line1"
                                                    value={addr.line1} onChange={(e) => updateAddressField(field.name, 'line1', e.target.value)} />
                                                <input className={inputClass} name="address-line2" placeholder="Address line 2 (optional)" autoComplete="shipping address-line2"
                                                    value={addr.line2 || ''} onChange={(e) => updateAddressField(field.name, 'line2', e.target.value)} />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className={inputClass} name="city" placeholder="City" autoComplete="shipping address-level2"
                                                        value={addr.city} onChange={(e) => updateAddressField(field.name, 'city', e.target.value)} />
                                                    <input className={inputClass} name="state" placeholder="State" autoComplete="shipping address-level1"
                                                        value={addr.state} onChange={(e) => updateAddressField(field.name, 'state', e.target.value)} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className={inputClass} name="postal_code" placeholder="ZIP code" autoComplete="shipping postal-code" inputMode="numeric"
                                                        value={addr.postal_code} onChange={(e) => updateAddressField(field.name, 'postal_code', e.target.value)} />
                                                    {/* USA-only: country is fixed to US (not a dropdown the
                                                        user can mis-set or autofill can leave blank). Kept as
                                                        a named hidden input so the autofill sweep reads it. */}
                                                    <input type="hidden" name="country" value="US" />
                                                    <div className={`${inputClass} flex items-center text-hackclub-muted bg-hackclub-smoke/40 cursor-not-allowed`}>United States</div>
                                                </div>
                                            </form>
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

                        {/* Live shipping rates — BOTH pathways. Reads the address from
                            checkoutData; updates as the customer fills it in. Points
                            orders are charged the rate converted at 1pt = $1 (shown
                            in the summary). */}
                        {cart.length > 0 && (
                            <LiveShippingRates
                                items={cart.map((i) => ({ id: String(i.id), variant_id: i.variant_id ?? undefined, quantity: i.quantity || 1 }))}
                                checkoutData={checkoutData}
                                shippingCountry={selectedShipping?.country}
                                onSelect={setSelectedRate}
                                priceInPoints={payWithPoints}
                            />
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
                                                {payWithPoints
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
                                <span>{payWithPoints ? formatPoints(itemsPoints) : formatCash(itemsCash)}</span>
                            </div>
                            {payWithPoints && selectedRate && (
                                <div className="flex justify-between items-center text-hackclub-slate">
                                    <span>Shipping ({selectedRate.label}):</span>
                                    <span>{shippingPointsCost > 0 ? formatPoints(shippingPointsCost) : 'Free'}</span>
                                </div>
                            )}
                            {!payWithPoints && selectedRate && (
                                <div className="flex justify-between items-center text-hackclub-slate">
                                    <span>Shipping ({selectedRate.label}):</span>
                                    <span>{shippingCash > 0 ? formatCash(shippingCash) : 'Free'}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
                                <span>{payWithPoints ? 'Points Required:' : 'Subtotal:'}</span>
                                <span className="text-hackclub-dark">{payWithPoints ? formatPoints(requiredPoints) : formatCash(cashTotal)}</span>
                            </div>
                            {!payWithPoints && hasDonation && deductibleEstimate > 0 && (
                                <div className="flex justify-between items-center text-sm font-bold text-hackclub-slate">
                                    <span>Estimated tax-deductible portion:</span>
                                    <span>{formatCash(deductibleEstimate)}</span>
                                </div>
                            )}
                            {!payWithPoints && (
                                <p className="text-xs text-hackclub-muted text-right">
                                    {hasDonation
                                        ? 'Sales tax applies only to the gift’s value, not your donation. Your receipt doubles as your tax acknowledgment.'
                                        : 'Any applicable sales tax is calculated at checkout.'}
                                </p>
                            )}
                            {payWithPoints && (
                                <div className="flex justify-between items-center text-sm text-hackclub-slate">
                                    <span>Your points:</span>
                                    <span>{formatPoints(pointsBalance)}</span>
                                </div>
                            )}
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-3 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl flex items-center justify-between gap-3">
                                    <p className="text-hackclub-red font-bold text-sm">{error}</p>
                                    {canCheckout && !loading && (
                                        <button
                                            type="button"
                                            onClick={handleCheckout}
                                            className="shrink-0 text-xs font-black text-white bg-hackclub-red hover:bg-hackclub-orange px-3 py-1.5 rounded-full transition-colors"
                                        >
                                            Try again
                                        </button>
                                    )}
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
                                    <motion.span key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center justify-center gap-2">
                                        <span className="inline-block w-5 h-5 border-[3px] border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                                        {payWithPoints ? 'Processing…' : 'Redirecting to checkout…'}
                                    </motion.span>
                                ) : canCheckout ? (
                                    <motion.span key="checkout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        {payWithPoints ? 'Checkout →' : hasDonation ? 'Complete donation →' : 'Pay with card →'}
                                    </motion.span>
                                ) : (
                                    <motion.span key="insufficient" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        {payWithPoints
                                            ? `Need ${remainingPointsNeeded} more points`
                                            : (cart.length === 0
                                                ? 'Cart is empty'
                                                : itemsCash <= 0
                                                    ? 'Not available for purchase'
                                                    : 'Select a shipping option')}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>

                        {/* Last thing a parent reads before committing: who they're
                            supporting and that payment is secure. */}
                        {!payWithPoints && (
                            <p className="text-center text-xs text-hackclub-muted font-bold leading-relaxed">
                                You&apos;re supporting Hack Club, a 501(c)(3) nonprofit. All proceeds
                                fund teenagers who build and ship real things. Payment is secure.
                            </p>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Checkout;
