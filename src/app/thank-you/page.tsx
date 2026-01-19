'use client';
import { useEffect } from 'react';

const ThankYou = () => {
  useEffect(() => {

    localStorage.removeItem('cart');
  }, []);

  return (
    <div className="bg-hackclub-dark min-h-screen text-white flex flex-col items-center justify-center">
      <div className="container mx-auto p-6 text-center">
        <h1 className="text-3xl font-bold">Thank You!</h1>
        <p className="mt-4">Your order has been successfully placed.</p>
        <p className="mt-4">Redirecting to the home page...</p>
      </div>
    </div>
  );
};

export default ThankYou;
