'use client';

import { useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { CreditsContext } from '../../context/CreditsContext';
import { ShippingOption, CheckoutField } from '../../types/Admin';

const HCB_DONATE_BASE = process.env.NEXT_PUBLIC_HCB_DONATE_BASE || 'https://hcb.hackclub.com/donations/start/hc-store';

const Checkout = () => {
  const { data: session, status } = useSession();
  const cartContext = useContext(CartContext);
  const creditsContext = useContext(CreditsContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [selectedShipping, setSelectedShipping] = useState<ShippingOption | null>(null);
  const [checkoutData, setCheckoutData] = useState<Record<string, string>>({});
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [checkoutFields, setCheckoutFields] = useState<CheckoutField[]>([]);
  const [loadingCheckoutInfo, setLoadingCheckoutInfo] = useState(true);
  const [showHCBModal, setShowHCBModal] = useState(false);
  const [claimCode, setClaimCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      signIn('hackclub', { callbackUrl: '/checkout' });
    }
  }, [status]);

  const loadClaimCode = async () => {
    setCodeLoading(true);
    try {
      const res = await fetch('/api/credits/claim-code');
      const data = await res.json();
      if (res.ok && data.result?.code) {
        setClaimCode(data.result.code);
      }
    } catch (err) {
      console.error('Failed to load claim code:', err);
    } finally {
      setCodeLoading(false);
    }
  };

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

  if (status === 'loading' || loadingCheckoutInfo) {
    return (
      <div className="bg-hackclub-smoke min-h-screen flex items-center justify-center">
        <div className="text-hackclub-dark font-bold">Loading...</div>
      </div>
    );
  }

  if (!session) return null;

  if (!cartContext || cartContext.cart === null) return null;

  const { cart, clearCart } = cartContext;
  const subtotal = cart.reduce((total, item) => total + parseFloat(item.price) * (item.quantity || 1), 0);
  const shippingCost = selectedShipping?.cost || 0;
  const totalBeforeCredits = Math.max(0, subtotal - couponDiscount + shippingCost);
  const totalPrice = totalBeforeCredits;

  const creditsBalance = creditsContext?.balance || 0;
  const hasEnoughCredits = creditsBalance >= totalPrice;
  const creditsToUse = Math.min(creditsBalance, totalPrice);
  const remainingAfterCredits = Math.max(0, totalPrice - creditsToUse);

  const applyCoupon = async () => {
    if (!couponCode.trim()) {
      setError('Please enter a coupon code');
      return;
    }

    setCouponLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode,
          cartTotal: subtotal,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to apply coupon');
        setCouponLoading(false);
        return;
      }

      setCouponDiscount(data.discount);
      setAppliedCoupon(couponCode);
      setCouponCode('');
      setError(null);
    } catch {
      setError('Failed to apply coupon');
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCouponDiscount(0);
    setAppliedCoupon(null);
    setCouponCode('');
  };

  const validateCheckoutFields = (): boolean => {
    for (const field of checkoutFields) {
      if (field.required && !checkoutData[field.name]) {
        setError(`${field.label} is required`);
        return false;
      }
    }
    return true;
  };

  const handleCheckout = async () => {
    if (shippingOptions.length > 0 && !selectedShipping) {
      setError('Please select a shipping option');
      return;
    }

    if (!validateCheckoutFields()) {
      return;
    }

    if (!hasEnoughCredits) {
      setError('Insufficient credits. Please add more credits to complete your purchase.');
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
          items: cart.map(item => ({
            id: String(item.id),
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
            variant_id: item.variant_id,
            thumbnail_url: item.thumbnail_url,
          })),
          totalAmount: totalPrice,
          shippingCost: selectedShipping?.cost || 0,
          shippingCountry: selectedShipping?.country,
          checkoutData,
          couponCode: appliedCoupon || undefined,
          couponDiscount: couponDiscount || 0,
          idempotencyKey,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to process order');
        setLoading(false);
        return;
      }

      if (creditsContext?.refreshCredits) {
        await creditsContext.refreshCredits();
      }

      clearCart();
      router.push('/thank-you');
    } catch {
      setError('Failed to connect to server. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-hackclub-smoke min-h-screen text-hackclub-dark">
      <div className="flex items-center justify-center py-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 24 }}
          transition={{ duration: 0.35, type: 'spring', stiffness: 180, damping: 18 }}
          className="w-full max-w-lg bg-white text-hackclub-dark rounded-3xl shadow-2xl p-8 border border-hackclub-smoke"
        >
          <h1 className="text-3xl font-black mb-2 text-hackclub-red">Checkout</h1>
          <h2 className="text-lg font-bold mb-6 text-hackclub-slate">Review your order details.</h2>
          
          <div className="divide-y divide-hackclub-smoke">
            <AnimatePresence initial={false}>
              {cart.length > 0 ? (
                cart.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-4 py-4"
                  >
                    {item.thumbnail_url && (
                      <Image
                        src={item.thumbnail_url}
                        alt={item.name}
                        width={56}
                        height={56}
                        className="rounded-xl bg-hackclub-smoke object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <div className="font-bold text-hackclub-dark">{item.name}</div>
                      <div className="text-hackclub-muted text-sm">Qty: {item.quantity || 1}</div>
                    </div>
                    <div className="font-black text-hackclub-red text-lg">${(parseFloat(item.price) * (item.quantity || 1)).toFixed(2)}</div>
                  </motion.div>
                ))
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-12 text-hackclub-muted font-bold"
                >
                  Your cart is empty.
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {cart.length > 0 && (
            <>
              {/* Shipping Selector */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke"
              >
                <label className="block font-bold text-hackclub-dark mb-3">Shipping Country</label>
                {shippingOptions.length === 0 ? (
                  <div className="w-full px-4 py-3 text-center text-hackclub-red font-bold bg-hackclub-red/10 border-2 border-hackclub-red rounded-lg">
                    No shipping options configured for this product
                  </div>
                ) : (
                <select
                  value={selectedShipping?.id || shippingOptions[0]?.id || ''}
                  onChange={(e) => {
                    console.log('[Checkout] Selected shipping value:', e.target.value);
                    const option = shippingOptions.find(s => s.id === e.target.value);
                    console.log('[Checkout] Found option:', option);
                    if (option) setSelectedShipping(option);
                  }}
                  className="w-full px-4 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                >
                  {shippingOptions.map((option, idx) => (
                    <option key={option.id || `ship_${idx}`} value={option.id || `ship_${idx}`}>
                      {option.country} - ${option.cost.toFixed(2)}
                    </option>
                  ))}
                </select>
                )}
              </motion.div>

              {/* Checkout Fields */}
              {checkoutFields.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 rounded-2xl bg-hackclub-smoke/30 border-2 border-hackclub-smoke space-y-3"
                >
                  <p className="font-bold text-hackclub-dark mb-3">Shipping Information</p>
                  {checkoutFields.map((field, idx) => (
                    <div key={field.id || `field_${idx}`}>
                      <label className="block text-sm font-bold text-hackclub-slate mb-1">
                        {field.label}
                        {field.required && <span className="text-hackclub-red">*</span>}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          placeholder={field.label}
                          value={checkoutData[field.name] || ''}
                          onChange={(e) => setCheckoutData({ ...checkoutData, [field.name]: e.target.value })}
                          className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                          rows={3}
                        />
                      ) : (
                        <input
                          type={field.type === 'address' ? 'text' : field.type}
                          placeholder={field.label}
                          value={checkoutData[field.name] || ''}
                          onChange={(e) => setCheckoutData({ ...checkoutData, [field.name]: e.target.value })}
                          className="w-full px-3 py-2 border-2 border-hackclub-smoke rounded-lg focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium"
                        />
                      )}
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Coupon Section */}
              {!appliedCoupon && (
                <div className="mt-6 p-4 bg-hackclub-smoke/30 rounded-2xl border-2 border-dashed border-hackclub-muted">
                  <p className="text-sm font-bold text-hackclub-muted mb-3">Have a coupon code?</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter coupon code"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                      disabled={couponLoading}
                      className="flex-1 px-3 py-2 rounded-lg border-2 border-hackclub-smoke focus:outline-none focus:border-hackclub-red text-hackclub-dark font-medium disabled:bg-gray-100"
                    />
                    <button
                      onClick={applyCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="px-4 py-2 bg-hackclub-red text-white font-bold rounded-lg hover:bg-hackclub-orange disabled:bg-gray-300 transition-colors"
                    >
                      {couponLoading ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                </div>
              )}

              {appliedCoupon && (
                <div className="mt-6 p-4 bg-hackclub-green/10 rounded-2xl border-2 border-hackclub-green">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-hackclub-green" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <p className="font-bold text-hackclub-green text-sm">Coupon Applied</p>
                        <p className="text-xs text-hackclub-slate">{appliedCoupon.toUpperCase()}</p>
                      </div>
                    </div>
                    <button
                      onClick={removeCoupon}
                      className="text-hackclub-green hover:text-hackclub-red transition-colors font-bold text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 p-3 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl"
                  >
                    <p className="text-hackclub-red font-bold text-sm">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-6 space-y-2">
                <div className="flex justify-between items-center text-hackclub-slate">
                  <span>Subtotal:</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between items-center text-hackclub-green">
                    <span>Discount:</span>
                    <span>-${couponDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-hackclub-slate">
                  <span>Shipping ({selectedShipping?.country}):</span>
                  <span>${shippingCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
                  <span>Total:</span>
                  <span className="text-hackclub-dark">${totalPrice.toFixed(2)}</span>
                </div>
                {creditsToUse > 0 && (
                  <div className="flex justify-between items-center text-hackclub-green">
                    <span>Credits Applied:</span>
                    <span>-${creditsToUse.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
                  <span>Amount Due:</span>
                  <span className="text-hackclub-red">${remainingAfterCredits.toFixed(2)}</span>
                </div>
              </div>

              <motion.button
                whileHover={(hasEnoughCredits || remainingAfterCredits > 0) && cart.length > 0 ? { scale: 1.03 } : {}}
                whileTap={(hasEnoughCredits || remainingAfterCredits > 0) && cart.length > 0 ? { scale: 0.97 } : {}}
                className={`w-full font-black text-lg py-3 rounded-full transition-all shadow-lg mt-6 ${
                  hasEnoughCredits && cart.length > 0
                    ? 'bg-hackclub-red hover:bg-hackclub-orange text-white hover:shadow-xl'
                    : remainingAfterCredits > 0 && cart.length > 0
                    ? 'bg-hackclub-blue hover:bg-hackclub-cyan text-white hover:shadow-xl'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                onClick={hasEnoughCredits ? handleCheckout : () => {
                  setClaimCode('');
                  setShowHCBModal(true);
                  loadClaimCode();
                }}
                disabled={loading || cart.length === 0}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {loading ? (
                    <motion.span
                      key="processing"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="inline-block animate-pulse">Processing…</span>
                    </motion.span>
                  ) : hasEnoughCredits ? (
                    <motion.span
                      key="checkout"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      Checkout →
                    </motion.span>
                  ) : remainingAfterCredits > 0 ? (
                    <motion.span
                      key="hcb"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      Pay ${remainingAfterCredits.toFixed(2)} with HCB →
                    </motion.span>
                  ) : (
                    <motion.span
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      Add items to cart
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </>
          )}
        </motion.div>
      </div>

      {showHCBModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50000,
          padding: '1rem',
        }} onClick={() => setShowHCBModal(false)}>
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 49999,
          }} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            style={{
              position: 'relative',
              zIndex: 50001,
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl border-2 border-gray-200 max-w-md w-full p-8"
          >
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-3xl font-black text-hackclub-dark mb-1">Pay with HCB</h2>
                <p className="text-hackclub-slate font-medium">
                  Amount due: <span className="text-hackclub-red font-bold">${remainingAfterCredits.toFixed(2)}</span>
                </p>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowHCBModal(false)}
                className="text-hackclub-muted hover:text-hackclub-dark transition-colors flex-shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </motion.button>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-hackclub-red font-black text-2xl">1.</p>
                  <p className="font-bold text-hackclub-dark">Your Claim Code</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={codeLoading ? 'Loading...' : claimCode}
                    readOnly
                    className="flex-1 bg-hackclub-smoke border-2 border-gray-200 rounded-xl px-4 py-3 font-mono font-bold text-hackclub-dark"
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => navigator.clipboard.writeText(claimCode)}
                    disabled={codeLoading || !claimCode}
                    className="p-3 bg-hackclub-smoke hover:bg-hackclub-dark hover:text-white rounded-xl transition-colors border-2 border-gray-200 hover:border-hackclub-dark disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy code"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </motion.button>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-hackclub-red font-black text-2xl">2.</p>
                  <p className="font-bold text-hackclub-dark">Donate on HCB</p>
                </div>
                <p className="text-hackclub-slate font-medium text-sm mb-3">
                  Enter <span className="font-mono font-bold bg-hackclub-smoke px-2 py-1 rounded">{claimCode || 'code'}</span> in your donation name
                </p>
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  href={`${HCB_DONATE_BASE}?message=${encodeURIComponent(claimCode)}&amount=${Math.round(remainingAfterCredits * 100)}&goods=true&name=${encodeURIComponent(claimCode)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-hackclub-blue hover:bg-hackclub-cyan text-white font-bold py-3 rounded-full text-center transition-colors"
                >
                  Open HCB Donation Page →
                </motion.a>
              </div>

              <div className="p-3 bg-hackclub-blue/10 border-2 border-hackclub-blue rounded-xl">
                <p className="text-hackclub-blue font-bold text-sm">After donating, come back here or refresh to complete your order.</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Checkout;
