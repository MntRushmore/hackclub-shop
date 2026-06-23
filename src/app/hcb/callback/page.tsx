'use client';
import { useEffect, useState, useContext, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CartContext } from '../../../context/CartContext';

type Status = 'waiting' | 'paid' | 'notfound' | 'timeout';

const CallbackInner = () => {
    const searchParams = useSearchParams();
    const orderId = searchParams.get('orderId');
    // Passed through from checkout so we can re-offer the donate link if the
    // popup was blocked. Optional — the order also stores it server-side.
    const donateUrl = searchParams.get('donate');
    const [status, setStatus] = useState<Status>(orderId ? 'waiting' : 'notfound');
    const cartContext = useContext(CartContext);

    useEffect(() => {
        if (!orderId) {
            setStatus('notfound');
            return;
        }

        // The donor pays on HCB in the other tab; the reconciler matches the
        // donation back to this order. Poll until it flips to paid. Generous
        // attempt budget (~3.5 min at 3s) since the donor has to fill the HCB form.
        let cancelled = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 70;

        const poll = async () => {
            try {
                const res = await fetch(`/api/checkout/hcb/status?orderId=${encodeURIComponent(orderId)}`);
                if (cancelled) return;
                if (res.status === 404) {
                    setStatus('notfound');
                    return;
                }
                const data = await res.json();
                if (data.paymentStatus === 'paid') {
                    cartContext?.clearCart();
                    setStatus('paid');
                    return;
                }
            } catch {
                // Network blip — fall through and retry.
            }

            attempts += 1;
            if (!cancelled) {
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(poll, 3000);
                } else {
                    setStatus('timeout');
                }
            }
        };

        poll();
        return () => {
            cancelled = true;
        };
    }, [orderId, cartContext]);

    const heading =
        status === 'paid' ? 'Thank You!'
            : status === 'notfound' ? 'Order not found'
                : status === 'timeout' ? 'Still waiting…'
                    : 'Complete your donation';
    const sub =
        status === 'paid'
            ? 'Your donation was received and your order is confirmed.'
            : status === 'notfound'
                ? "We couldn't find that order. If you donated, contact us and we'll sort it out."
                : status === 'timeout'
                    ? "We haven't seen your donation yet. If you've completed it, it can take a moment to appear — we'll email you as soon as it lands."
                    : 'Finish your donation on the HCB tab that just opened. This page will update automatically once it goes through.';

    return (
        <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
            <h1 className="text-5xl font-black text-hackclub-red mb-4">{heading}</h1>
            <p className="text-2xl font-bold mb-2 max-w-xl">{sub}</p>

            {status === 'waiting' && (
                <>
                    <p className="text-hackclub-muted mb-6 animate-pulse">Waiting for your donation…</p>
                    {donateUrl && (
                        <a
                            href={donateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mb-8 bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors"
                        >
                            Open the donation page →
                        </a>
                    )}
                </>
            )}
            {status === 'timeout' && donateUrl && (
                <a
                    href={donateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mb-8 bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors"
                >
                    Open the donation page again →
                </a>
            )}
            {status === 'paid' && (
                <p className="text-hackclub-muted mb-8">A confirmation has been sent to your email.</p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Link href="/shop" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">Continue Shopping</Link>
                {status === 'paid' && (
                    <Link href="/orders/track" className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors">Track your order</Link>
                )}
                {(status === 'timeout' || status === 'notfound') && (
                    <Link href="/orders/track" className="inline-block border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate font-bold px-8 py-3 rounded-full transition-colors">Look up an order</Link>
                )}
            </div>
        </div>
    );
};

const HcbCallback = () => (
    <Suspense fallback={<div className="bg-white min-h-screen flex items-center justify-center text-hackclub-dark font-bold">Loading…</div>}>
        <CallbackInner />
    </Suspense>
);

export default HcbCallback;
