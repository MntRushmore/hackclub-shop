'use client';

import { useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { CartContext } from '../../context/CartContext';

interface CartItem {
  id: number;
  name: string;
  price: string;
  thumbnail_url: string;
  variant_id: number | null;
  quantity: number;
}

const Checkout = () => {
  const cartContext = useContext(CartContext);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (!cartContext || cartContext.cart === null) return null;

  const { cart, clearCart } = cartContext;
  const totalPrice = cart.reduce((total, item) => total + parseFloat(item.price) * (item.quantity || 1), 0);

  const handleCheckout = () => {
    setLoading(true);
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
          <div className="flex justify-between items-center mt-8 mb-4 text-xl font-black">
            <span>Total:</span>
            <span className="text-hackclub-red">${totalPrice.toFixed(2)}</span>
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