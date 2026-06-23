'use client';
import { useEffect, useContext, Suspense } from 'react';
import Link from 'next/link';
import { CartContext } from '../../context/CartContext';

/**
 * Student (points) order success page. Points orders settle in-request, so by
 * the time we land here the order is already placed — no polling needed. Guest
 * (HCB donation) orders confirm on `/hcb/callback` instead, which reconciles the
 * donation before showing success.
 */
const ThankYouInner = () => {
  const cartContext = useContext(CartContext);

  // Clear the cart on success — both the in-memory context (so the nav badge
  // resets) and localStorage. Idempotent with the clear at checkout.
  useEffect(() => {
    cartContext?.clearCart();
  }, [cartContext]);

  return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
      <h1 className="text-5xl font-black text-hackclub-red mb-4">Thank You!</h1>
      <p className="text-2xl font-bold mb-2">Your order has been successfully placed.</p>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        <Link href="/shop" className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors">Continue Shopping</Link>
        <Link href="/orders" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">View your orders</Link>
      </div>
    </div>
  );
};

const ThankYou = () => (
  <Suspense fallback={<div className="bg-white min-h-screen flex items-center justify-center text-hackclub-dark font-bold">Loading…</div>}>
    <ThankYouInner />
  </Suspense>
);

export default ThankYou;
