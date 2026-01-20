'use client';

import { useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { CreditsContext } from '../../context/CreditsContext';

const Checkout = () => {
  const cartContext = useContext(CartContext);
  const creditsContext = useContext(CreditsContext);
  const [loading, setLoading] = useState(false);
  const [useCredits, setUseCredits] = useState(false);
  const router = useRouter();

  if (!cartContext || cartContext.cart === null) return null;

  const { cart, clearCart } = cartContext;
  const totalPrice = cart.reduce((total, item) => total + parseFloat(item.price) * (item.quantity || 1), 0);

  const creditsBalance = creditsContext?.balance || 0;
  const creditsToApply = useCredits ? Math.min(creditsBalance, totalPrice) : 0;
  const remainingTotal = totalPrice - creditsToApply;

  const handleCheckout = () => {
    setLoading(true);
    if (useCredits && creditsToApply > 0 && creditsContext) {
      creditsContext.useCredits(creditsToApply, `order_${Date.now()}`);
    }

    clearCart();
    setTimeout(() => {
      setLoading(false);
      router.push('/thank-you');
      setTimeout(() => {
        router.push('/');
      }, 2000);
    }, 2000);
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
          {/* Credits Section */}
          {creditsBalance > 0 && cart.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-hackclub-smoke rounded-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-hackclub-green rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-hackclub-dark">Use Credits</p>
                    <p className="text-sm text-hackclub-muted">Balance: ${creditsBalance.toFixed(2)}</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCredits}
                    onChange={(e) => setUseCredits(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-hackclub-green"></div>
                </label>
              </div>
              {useCredits && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 pt-3 border-t border-hackclub-smoke"
                >
                  <div className="flex justify-between text-sm">
                    <span className="text-hackclub-muted">Credits applied:</span>
                    <span className="font-bold text-hackclub-green">-${creditsToApply.toFixed(2)}</span>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Order Summary */}
          <div className="mt-6 space-y-2">
            <div className="flex justify-between items-center text-hackclub-slate">
              <span>Subtotal:</span>
              <span>${totalPrice.toFixed(2)}</span>
            </div>
            {useCredits && creditsToApply > 0 && (
              <div className="flex justify-between items-center text-hackclub-green">
                <span>Credits:</span>
                <span>-${creditsToApply.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-xl font-black pt-2 border-t border-hackclub-smoke">
              <span>Total:</span>
              <span className="text-hackclub-red">${remainingTotal.toFixed(2)}</span>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg py-3 rounded-full transition-all shadow-lg hover:shadow-xl mt-2"
            onClick={handleCheckout}
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