'use client';
import { useEffect, useState, useContext, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CartContext } from '../../context/CartContext';
import { shareText } from '../../lib/shareCard';

type GuestStatus = 'loading' | 'processing' | 'paid' | 'notfound' | 'slow';
type DonationShare = { tier: string; vestNumber?: number };

/**
 * Order success page, both pathways:
 *  - Student (points) orders settle in-request, so landing here means the order
 *    is already placed — show success immediately.
 *  - Guest (Stripe) orders return here with `?session_id=`. The webhook finalizes
 *    the order asynchronously, so poll the status until it flips to `paid` (the
 *    redirect itself is never proof of payment). The cart is cleared only once
 *    payment is confirmed.
 */
const ThankYouInner = () => {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  // Sustainer subscription success: no shop order exists to poll, and Stripe
  // only redirects here after the subscription's first payment succeeds.
  const isSustainer = searchParams.get('sustain') === '1';
  const isGuest = Boolean(sessionId) && !isSustainer;
  const [status, setStatus] = useState<GuestStatus>(isGuest ? 'loading' : 'paid');
  const [donation, setDonation] = useState<DonationShare | null>(isSustainer ? { tier: 'Sustainer' } : null);
  const [copied, setCopied] = useState(false);
  const cartContext = useContext(CartContext);

  // Student order: cart already cleared at checkout; clear again here (idempotent)
  // so the nav badge resets. Guests clear only on confirmed payment (below).
  useEffect(() => {
    if (!isGuest) cartContext?.clearCart();
  }, [isGuest, cartContext]);

  useEffect(() => {
    if (!isGuest) return;

    let cancelled = false;
    let attempts = 0;
    // The webhook finalizes asynchronously; give it a generous budget (~90s at
    // 1.5s) so a slow/retried delivery doesn't strand a customer who DID pay.
    const MAX_ATTEMPTS = 60;

    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/stripe/status?session_id=${encodeURIComponent(sessionId!)}`);
        if (cancelled) return;
        // A 404 right after the redirect is usually the session→order pointer not
        // being readable yet (write replication lag), NOT a real missing order —
        // so keep polling rather than declaring it lost. Only show "not found"
        // if it's still 404 once the whole budget is exhausted.
        if (res.status !== 404) {
          const data = await res.json();
          if (data.paymentStatus === 'paid') {
            // Confirmed paid — now it's safe to clear the cart.
            cartContext?.clearCart();
            if (data.donation?.tier) setDonation(data.donation);
            setStatus('paid');
            return;
          }
          setStatus('processing');
        }
      } catch {
        if (!cancelled) setStatus('processing');
      }

      attempts += 1;
      if (cancelled) return;
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(poll, 1500);
      } else {
        // Budget exhausted. If we never saw the order at all it's likely genuinely
        // missing; otherwise the payment is just confirming slower than we waited.
        // Either way DON'T clear the cart (payment wasn't confirmed) and tell the
        // customer we'll email them — they aren't stranded.
        setStatus((s) => (s === 'loading' ? 'notfound' : 'slow'));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [isGuest, sessionId, cartContext]);

  const heading =
    status === 'paid' ? (donation ? 'You just backed a teenager.' : 'Thank You!')
      : status === 'notfound' ? 'Order not found'
        : status === 'slow' ? 'Almost there…'
          : 'Almost there…';
  const sub =
    status === 'paid'
      ? (isSustainer
          ? "You're a Hack Club Sustainer now. Your monthly donation is live, and your name is headed for the donor wall."
          : donation
            ? 'Your donation is in. Your thank-you gift ships soon, and your tax receipt is in your inbox.'
            : 'Your order has been successfully placed.')
      : status === 'notfound'
        ? "We couldn't find that order. If you were charged, get in touch and we'll sort it out."
        : status === 'slow'
          ? "Your payment is taking a little longer than usual to confirm. If you completed it, you're all set. We'll email your confirmation as soon as it lands."
          : 'Your payment is being confirmed. This usually takes a few seconds.';

  // Share card: /backed renders the OG image a post unfurls into.
  const shareUrl = donation
    ? `https://shop.hackclub.com/backed?${new URLSearchParams({
        t: donation.tier,
        ...(donation.vestNumber ? { n: String(donation.vestNumber) } : {}),
      }).toString()}`
    : '';
  const postText = donation ? shareText(donation.tier, donation.vestNumber ?? null, shareUrl) : '';

  return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
      <h1 className="text-5xl font-black text-hackclub-red mb-4">{heading}</h1>
      <p className="text-2xl font-bold mb-2 max-w-xl">{sub}</p>
      {status === 'processing' && (
        <p className="text-hackclub-muted mb-8 animate-pulse">Confirming payment…</p>
      )}
      {status === 'paid' && (
        <p className="text-hackclub-muted mb-8">A confirmation has been sent to your email.</p>
      )}
      {status === 'paid' && donation && (
        <div className="w-full max-w-lg mb-8 p-6 rounded-2xl border-2 border-hackclub-smoke bg-hackclub-smoke/30 text-left">
          <p className="font-black text-hackclub-dark mb-1">
            {donation.vestNumber
              ? `Your vest is #${String(donation.vestNumber).padStart(3, '0')} of 100.`
              : 'Tell the world.'}
          </p>
          <p className="text-hackclub-slate text-sm font-medium mb-4">
            Sharing it is the easiest way to get one more teenager backed.
          </p>
          <p className="text-hackclub-dark text-sm font-medium bg-white border border-hackclub-smoke rounded-xl p-3 mb-4">
            {postText}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(postText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-hackclub-dark hover:bg-black text-white font-bold text-sm px-5 py-2 rounded-full transition-colors"
            >
              Share on X
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(postText).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }).catch(() => {});
              }}
              className="border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold text-sm px-5 py-2 rounded-full transition-colors"
            >
              {copied ? 'Copied!' : 'Copy text'}
            </button>
          </div>
        </div>
      )}
      {status === 'notfound' && (
        <p className="text-hackclub-muted mb-8">
          Email{' '}
          <a href="mailto:shop@hackclub.com" className="text-hackclub-red font-bold hover:underline">shop@hackclub.com</a>
          {' '}and we&apos;ll help.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        <Link href="/shop" className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors">Continue Shopping</Link>
        {isGuest
          ? (status === 'paid' || status === 'slow') && (
              <Link href="/orders/track" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">Track your order</Link>
            )
          : (
              <Link href="/orders" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">View your orders</Link>
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
