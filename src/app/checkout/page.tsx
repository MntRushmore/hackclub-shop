'use client';

import { useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { CreditsContext } from '../../context/CreditsContext';

const Checkout = () => {
  const { data: session, status } = useSession();
  const cartContext = useContext(CartContext);
  const creditsContext = useContext(CreditsContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      signIn('hackclub', { callbackUrl: '/checkout' });
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="bg-hackclub-smoke min-h-screen flex items-center justify-center">
        <div className="text-hackclub-dark font-bold">Loading...</div>
      </div>
    );
  }

  if (!session) return null;

  if (!cartContext || cartContext.cart === null) return null;

  const { cart, clearCart } = cartContext;
  const totalPrice = cart.reduce((total, item) => total + parseFloat(item.price) * (item.quantity || 1), 0);

  const creditsBalance = creditsContext?.balance || 0;
  const hasEnoughCredits = creditsBalance >= totalPrice;

  const handleCheckout = async () => {
    if (!hasEnoughCredits) {
      setError('Insufficient credits. Please add more credits to complete your purchase.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
            thumbnail_url: item.thumbnail_url,
          })),
          totalAmount: totalPrice,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to process order');
        setLoading(false);
        return;
      }

      // Refresh credits balance
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
          <h2 className="text-lg font-bold mb-6 text-hackclub-slate">Review your cart before completing your order.</h2>
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
          {/* Credits Balance */}
          {cart.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-6 p-4 rounded-2xl ${hasEnoughCredits ? 'bg-hackclub-green/10 border-2 border-hackclub-green' : 'bg-hackclub-red/10 border-2 border-hackclub-red'}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasEnoughCredits ? 'bg-hackclub-green' : 'bg-hackclub-red'}`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-bold text-hackclub-dark">Your Credits</p>
                  <p className="text-sm text-hackclub-muted">Balance: ${creditsBalance.toFixed(2)}</p>
                </div>
                {hasEnoughCredits ? (
                  <span className="text-hackclub-green font-bold text-sm">✓ Sufficient</span>
                ) : (
                  <Link 
                    href="/credits" 
                    className="text-hackclub-red font-bold text-sm hover:underline"
                  >
                    Add Credits →
                  </Link>
                )}
              </div>
              {!hasEnoughCredits && (
                <p className="mt-3 text-sm text-hackclub-red font-medium">
                  You need ${(totalPrice - creditsBalance).toFixed(2)} more credits to complete this purchase.
                </p>
              )}
            </motion.div>
          )}

          {/* Error Message */}
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

          {/* Order Summary */}
          <div className="mt-6 space-y-2">
            <div className="flex justify-between items-center text-hackclub-slate">
              <span>Subtotal:</span>
              <span>${totalPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-hackclub-green">
              <span>Pay with Credits:</span>
              <span>-${totalPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
              <span>Total:</span>
              <span className="text-hackclub-red">$0.00</span>
            </div>
          </div>

          <motion.button
            whileHover={hasEnoughCredits && cart.length > 0 ? { scale: 1.03 } : {}}
            whileTap={hasEnoughCredits && cart.length > 0 ? { scale: 0.97 } : {}}
            className={`w-full font-black text-lg py-3 rounded-full transition-all shadow-lg mt-2 ${
              hasEnoughCredits && cart.length > 0 
                ? 'bg-hackclub-red hover:bg-hackclub-orange text-white hover:shadow-xl' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            onClick={handleCheckout}
            disabled={loading || cart.length === 0 || !hasEnoughCredits}
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
              ) : (
                <motion.span
                  key="checkout"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  Checkout →
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
};

export default Checkout;