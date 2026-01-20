
'use client';
import { useEffect } from 'react';
import Link from 'next/link';

const ThankYou = () => {
  useEffect(() => {

    localStorage.removeItem('cart');
  }, []);

  return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
      <h1 className="text-5xl font-black text-hackclub-red mb-4">Thank You!</h1>
      <p className="text-2xl font-bold mb-2">Your order has been successfully placed.</p>
      <p className="text-hackclub-muted mb-8">Redirecting to the home page...</p>
      <Link href="/shop" className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors">Continue Shopping</Link>
    </div>
  );
};

export default ThankYou;
