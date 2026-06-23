'use client';
import { useEffect, useState, useContext, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CartContext } from '../../context/CartContext';

type GuestStatus = 'loading' | 'processing' | 'paid' | 'notfound';

const ThankYouInner = () => {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const isGuest = Boolean(sessionId);
  const [status, setStatus] = useState<GuestStatus>(isGuest ? 'loading' : 'paid');
  const cartContext = useContext(CartContext);

  // Always clear the cart on the thank-you page — both the in-memory context
  // (so the nav badge resets) and localStorage. Student checkout also clears it,
  // but doing it here too is idempotent and covers the guest/Stripe return.
  useEffect(() => {
    cartContext?.clearCart();
  }, [cartContext]);

  useEffect(() => {
    if (!isGuest) {
      // Student order: cart already cleared above + at checkout.
      return;
    }

    // Guest landed here after Stripe. The webhook finalizes the order
    // asynchronously, so poll the status until it flips to paid.
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/stripe/status?session_id=${encodeURIComponent(sessionId!)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setStatus('notfound');
          return;
        }
        const data = await res.json();
        if (data.paymentStatus === 'paid') {
          setStatus('paid');
          return;
        }
        setStatus('processing');
      } catch {
        if (!cancelled) setStatus('processing');
      }

      attempts += 1;
      if (!cancelled && attempts < 10) {
        setTimeout(poll, 1500);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [isGuest, sessionId]);

  const heading = status === 'paid' ? 'Thank You!' : status === 'notfound' ? 'Order not found' : 'Almost there…';
  const sub =
    status === 'paid'
      ? 'Your order has been successfully placed.'
      : status === 'notfound'
        ? "We couldn't find that order. If you were charged, contact us and we'll sort it out."
        : 'Your payment is being confirmed. This usually takes a few seconds.';

  return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
      <h1 className="text-5xl font-black text-hackclub-red mb-4">{heading}</h1>
      <p className="text-2xl font-bold mb-2">{sub}</p>
      {status === 'processing' && (
        <p className="text-hackclub-muted mb-8 animate-pulse">Confirming payment…</p>
      )}
      {status === 'paid' && (
        <p className="text-hackclub-muted mb-8">A confirmation has been sent to your email.</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/shop" className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors">Continue Shopping</Link>
        {isGuest && status === 'paid' && (
          <Link href="/orders/track" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">Track your order</Link>
        )}
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
