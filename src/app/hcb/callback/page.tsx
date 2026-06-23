'use client';
import { useEffect, useState, useContext, useCallback, useRef, Suspense } from 'react';
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
    const [checking, setChecking] = useState(false);
    const cartContext = useContext(CartContext);
    // Lets a manual "paid" result stop the background auto-poll loop.
    const settledRef = useRef(false);

    // One status check shared by the auto-poll loop and the manual button.
    // Returns true once the order is confirmed paid (so the poller can stop).
    const checkOnce = useCallback(async (): Promise<boolean> => {
        if (!orderId) return false;
        try {
            const res = await fetch(`/api/checkout/hcb/status?orderId=${encodeURIComponent(orderId)}`);
            if (res.status === 404) {
                setStatus('notfound');
                settledRef.current = true;
                return false;
            }
            const data = await res.json();
            if (data.paymentStatus === 'paid') {
                cartContext?.clearCart();
                setStatus('paid');
                settledRef.current = true;
                return true;
            }
        } catch {
            // Network blip — caller will retry.
        }
        return false;
    }, [orderId, cartContext]);

    // Auto-poll: the donor pays on HCB in the other tab; the reconciler matches
    // the donation back to this order. Poll until paid. Generous attempt budget
    // (~3.5 min at 3s) since the donor has to fill the HCB form.
    useEffect(() => {
        if (!orderId) {
            setStatus('notfound');
            return;
        }
        let cancelled = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 70;

        const poll = async () => {
            if (cancelled || settledRef.current) return;
            const paid = await checkOnce();
            if (cancelled || paid || settledRef.current) return;
            attempts += 1;
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(poll, 3000);
            } else {
                setStatus('timeout');
            }
        };

        poll();
        return () => {
            cancelled = true;
        };
    }, [orderId, checkOnce]);

    // Manual "check now" — for an impatient donor who's already paid.
    const handleManualCheck = useCallback(async () => {
        if (checking) return;
        setChecking(true);
        const paid = await checkOnce();
        // If they hit it after the auto-poll gave up, drop them back into the
        // waiting state so the loop's "timeout" copy doesn't linger on a retry.
        if (!paid) setStatus((s) => (s === 'timeout' ? 'waiting' : s));
        setChecking(false);
    }, [checking, checkOnce]);

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

    const showWaitingControls = status === 'waiting' || status === 'timeout';

    return (
        <div className="bg-white min-h-screen flex flex-col items-center justify-center text-hackclub-dark text-center px-4">
            <h1 className="text-5xl font-black text-hackclub-red mb-4">{heading}</h1>
            <p className="text-2xl font-bold mb-2 max-w-xl">{sub}</p>

            {status === 'waiting' && (
                <p className="text-hackclub-muted mb-6 animate-pulse">Waiting for your donation…</p>
            )}

            {showWaitingControls && (
                <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
                    {donateUrl && (
                        <a
                            href={donateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-8 py-3 rounded-full shadow-lg transition-colors"
                        >
                            {status === 'timeout' ? 'Open the donation page again →' : 'Open the donation page →'}
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={handleManualCheck}
                        disabled={checking}
                        className={`inline-flex items-center gap-2 border-2 font-bold px-8 py-3 rounded-full transition-colors ${
                            checking
                                ? 'border-hackclub-smoke text-hackclub-muted cursor-not-allowed'
                                : 'border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate'
                        }`}
                    >
                        {checking && <span className="inline-block w-4 h-4 border-2 border-hackclub-muted/40 border-t-hackclub-slate rounded-full animate-spin" aria-hidden="true" />}
                        {checking ? 'Checking…' : "I've donated — check now"}
                    </button>
                </div>
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
