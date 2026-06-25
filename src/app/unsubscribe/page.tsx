'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';

const gridBg = {
    backgroundImage:
        'linear-gradient(to right, #e0f2fe 1px, transparent 1px), linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)',
    backgroundSize: '30px 30px',
};

type State = 'idle' | 'working' | 'unsubscribed' | 'resubscribed' | 'error';

const UnsubscribeInner = () => {
    const params = useSearchParams();
    const email = params.get('email') || '';
    const token = params.get('token') || '';

    const [state, setState] = useState<State>('idle');
    const [error, setError] = useState<string | null>(null);

    const call = async (action: 'unsubscribe' | 'resubscribe') => {
        setState('working');
        setError(null);
        try {
            const res = await fetch('/api/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, token, action }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Something went wrong.');
                setState('error');
                return;
            }
            setState(action === 'resubscribe' ? 'resubscribed' : 'unsubscribed');
        } catch {
            setError('Network error. Please try again.');
            setState('error');
        }
    };

    // Unsubscribe immediately on load — clicking the link IS the intent. The page
    // then confirms it and offers a one-tap resubscribe.
    useEffect(() => {
        if (email && token) call('unsubscribe');
        else {
            setError('This unsubscribe link is missing its details.');
            setState('error');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen bg-white text-hackclub-dark" style={gridBg}>
            <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="bg-white border border-hackclub-smoke border-t-4 border-t-hackclub-red p-8 text-center"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/images/hack-club-shop-wordmark.png"
                        alt="Hack Club Shop"
                        className="h-9 w-auto mx-auto mb-6"
                    />

                    {state === 'working' && (
                        <p className="text-lg font-bold text-hackclub-slate">Updating your preferences…</p>
                    )}

                    {state === 'unsubscribed' && (
                        <>
                            <h1 className="text-3xl font-black mb-2">You&apos;re unsubscribed</h1>
                            <p className="text-hackclub-slate font-medium mb-6">
                                {email && <span className="font-bold text-hackclub-dark">{email}</span>} won&apos;t get
                                marketing or promotional emails from the Hack Club Shop anymore.
                            </p>
                            <p className="text-sm text-hackclub-muted mb-6">
                                You&apos;ll still get <span className="font-bold">order receipts</span> and{' '}
                                <span className="font-bold">shipping updates</span> — you need those to track what you bought.
                            </p>
                            <button
                                onClick={() => call('resubscribe')}
                                className="text-hackclub-blue font-bold hover:underline"
                            >
                                Changed your mind? Resubscribe
                            </button>
                        </>
                    )}

                    {state === 'resubscribed' && (
                        <>
                            <h1 className="text-3xl font-black mb-2">You&apos;re back in 🎉</h1>
                            <p className="text-hackclub-slate font-medium mb-6">
                                {email && <span className="font-bold text-hackclub-dark">{email}</span>} will receive Hack
                                Club Shop emails again.
                            </p>
                            <button
                                onClick={() => call('unsubscribe')}
                                className="text-hackclub-muted font-bold hover:underline text-sm"
                            >
                                Unsubscribe again
                            </button>
                        </>
                    )}

                    {state === 'error' && (
                        <>
                            <h1 className="text-3xl font-black mb-2 text-hackclub-red">Hmm, that didn&apos;t work</h1>
                            <p className="text-hackclub-slate font-medium mb-6">{error}</p>
                            <p className="text-sm text-hackclub-muted">
                                Need help? Email{' '}
                                <a href="mailto:shop@hackclub.com" className="text-hackclub-blue font-bold hover:underline">
                                    shop@hackclub.com
                                </a>
                                .
                            </p>
                        </>
                    )}

                    <div className="mt-8 pt-6 border-t border-hackclub-smoke">
                        <Link href="/shop" className="text-sm text-hackclub-muted font-bold hover:text-hackclub-red transition-colors">
                            ← Back to the shop
                        </Link>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

const UnsubscribePage = () => (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-hackclub-dark font-bold">Loading…</div>}>
        <UnsubscribeInner />
    </Suspense>
);

export default UnsubscribePage;
