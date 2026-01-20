'use client';

import { useContext, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signIn } from 'next-auth/react';
import { CreditsContext } from '../../context/CreditsContext';

const HCB_DONATE_URL = 'https://hcb.hackclub.com/donations/start/ysws-combinator';

// Generate a unique claim code
const generateClaimCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0/O, 1/I
    let code = 'HC-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

const CreditsPage = () => {
    const { data: session, status } = useSession();
    const creditsContext = useContext(CreditsContext);
    const [showAddCredits, setShowAddCredits] = useState(false);
    const [claimCode, setClaimCode] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ amount: number } | null>(null);

    useEffect(() => {
        // Generate or retrieve claim code from localStorage
        const savedCode = localStorage.getItem('hcb_claim_code');
        if (savedCode) {
            setClaimCode(savedCode);
        } else {
            const newCode = generateClaimCode();
            localStorage.setItem('hcb_claim_code', newCode);
            setClaimCode(newCode);
        }
    }, []);

    if (!creditsContext) return null;

    // Show loading state
    if (status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white"
                style={{
                    backgroundImage: `
                      linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                      linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                    `,
                    backgroundSize: '30px 30px',
                }}
            >
                <div className="animate-pulse text-hackclub-slate font-bold">Loading...</div>
            </div>
        );
    }

    // Require authentication
    if (!session) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white"
                style={{
                    backgroundImage: `
                      linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                      linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                    `,
                    backgroundSize: '30px 30px',
                }}
            >
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <div className="w-16 h-16 bg-hackclub-red/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-hackclub-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Sign In Required</h2>
                    <p className="text-hackclub-slate mb-6">
                        You need to sign in with your Hack Club account to view and manage your credits.
                    </p>
                    <button
                        onClick={() => signIn('hackclub')}
                        className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Sign In with Hack Club
                    </button>
                </div>
            </div>
        );
    }

    const { balance, transactions, refreshCredits } = creditsContext;

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleGenerateNewCode = () => {
        const newCode = generateClaimCode();
        localStorage.setItem('hcb_claim_code', newCode);
        setClaimCode(newCode);
        setError(null);
        setSuccess(null);
    };

    const handleVerifyPayment = async () => {
        setVerifying(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch(`/api/credits/hcb?code=${encodeURIComponent(claimCode)}`);
            const data = await response.json();

            if (response.ok && data.result) {
                // Refresh credits from server (HCB route already added them)
                await refreshCredits();
                setSuccess({ amount: data.result.amount });
                // Generate new code for next time
                handleGenerateNewCode();
            } else {
                setError(data.error || 'Failed to verify donation');
            }
        } catch {
            setError('Failed to connect to server');
        } finally {
            setVerifying(false);
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(claimCode);
    };

    return (
        <div className="min-h-screen text-hackclub-dark bg-white"
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-2">
                        Your Credits
                    </h1>
                    <p className="text-lg text-hackclub-slate font-medium mb-10">
                        Add credits via HCB and use them at checkout
                    </p>

                    {/* Balance Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, delay: 0.1 }}
                        className="bg-white rounded-2xl p-6 shadow-lg border-2 border-hackclub-smoke mb-8"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-hackclub-muted font-bold text-sm uppercase tracking-wide mb-1">Available Balance</p>
                                <motion.p
                                    key={balance}
                                    initial={{ scale: 1.05 }}
                                    animate={{ scale: 1 }}
                                    className="text-4xl sm:text-5xl font-black text-hackclub-dark"
                                >
                                    ${balance.toFixed(2)}
                                </motion.p>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setShowAddCredits(true)}
                                className="bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-base px-6 py-3 rounded-full shadow-md hover:shadow-lg transition-all"
                            >
                                + Add Credits
                            </motion.button>
                        </div>
                    </motion.div>

                    {/* Add Credits Modal */}
                    <AnimatePresence>
                        {showAddCredits && (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="fixed inset-0 bg-black/50 z-[10001]"
                                    onClick={() => {
                                        setShowAddCredits(false);
                                        setError(null);
                                        setSuccess(null);
                                    }}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl p-6 shadow-2xl z-[10002] w-full max-w-md mx-4"
                                >
                                    <h2 className="text-2xl font-black text-hackclub-dark mb-1">Add Credits via HCB</h2>
                                    <p className="text-hackclub-slate text-sm mb-5">
                                        Donate to our HCB organization and claim your credits
                                    </p>

                                    {/* Success Message */}
                                    <AnimatePresence>
                                        {success && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className="mb-5 p-4 bg-hackclub-green/10 border-2 border-hackclub-green rounded-xl"
                                            >
                                                <p className="text-hackclub-green font-bold">
                                                    Successfully added ${success.amount.toFixed(2)} credits!
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Step 1: Your Code */}
                                    <div className="mb-5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-6 h-6 bg-hackclub-red text-white rounded-full flex items-center justify-center text-sm font-black">1</span>
                                            <p className="font-bold text-hackclub-dark">Your Claim Code</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 bg-hackclub-smoke rounded-xl px-4 py-3 font-mono text-lg font-bold text-hackclub-dark tracking-wider">
                                                {claimCode}
                                            </div>
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={copyToClipboard}
                                                className="p-3 bg-hackclub-smoke hover:bg-hackclub-dark hover:text-white rounded-xl transition-colors"
                                                title="Copy code"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                            </motion.button>
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={handleGenerateNewCode}
                                                className="p-3 bg-hackclub-smoke hover:bg-hackclub-dark hover:text-white rounded-xl transition-colors"
                                                title="Generate new code"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                            </motion.button>
                                        </div>
                                    </div>

                                    {/* Step 2: Donate */}
                                    <div className="mb-5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-6 h-6 bg-hackclub-red text-white rounded-full flex items-center justify-center text-sm font-black">2</span>
                                            <p className="font-bold text-hackclub-dark">Donate on HCB</p>
                                        </div>
                                        <p className="text-hackclub-slate text-sm mb-3">
                                            Include your claim code <span className="font-mono font-bold text-hackclub-red">{claimCode}</span> in the donation memo/message.
                                        </p>
                                        <motion.a
                                            href={HCB_DONATE_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            className="block w-full bg-hackclub-blue hover:bg-hackclub-cyan text-white font-bold py-3 rounded-xl text-center transition-colors"
                                        >
                                            Open HCB Donation Page →
                                        </motion.a>
                                    </div>

                                    {/* Step 3: Claim */}
                                    <div className="mb-5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-6 h-6 bg-hackclub-red text-white rounded-full flex items-center justify-center text-sm font-black">3</span>
                                            <p className="font-bold text-hackclub-dark">Claim Your Credits</p>
                                        </div>
                                        <p className="text-hackclub-slate text-sm mb-3">
                                            After donating, click below to verify and add credits to your account.
                                        </p>

                                        {/* Error Message */}
                                        <AnimatePresence>
                                            {error && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -10 }}
                                                    className="mb-3 p-3 bg-hackclub-red/10 border-2 border-hackclub-red rounded-xl"
                                                >
                                                    <p className="text-hackclub-red text-sm font-medium">{error}</p>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={handleVerifyPayment}
                                            disabled={verifying}
                                            className="w-full bg-hackclub-green hover:bg-hackclub-cyan text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {verifying ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                    Verifying...
                                                </span>
                                            ) : (
                                                "I've Donated - Claim Credits"
                                            )}
                                        </motion.button>
                                    </div>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => {
                                            setShowAddCredits(false);
                                            setError(null);
                                            setSuccess(null);
                                        }}
                                        className="w-full bg-hackclub-smoke hover:bg-hackclub-dark hover:text-white text-hackclub-dark font-bold py-3 rounded-full transition-colors"
                                    >
                                        Close
                                    </motion.button>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>

                    {/* Transaction History */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.2 }}
                        className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden"
                    >
                        <div className="px-6 py-4 border-b-2 border-hackclub-smoke">
                            <h2 className="text-xl font-black text-hackclub-dark">Transaction History</h2>
                        </div>

                        {transactions.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <div className="w-14 h-14 bg-hackclub-smoke rounded-full flex items-center justify-center mx-auto mb-3">
                                    <svg className="w-7 h-7 text-hackclub-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                </div>
                                <p className="text-hackclub-muted font-bold">No transactions yet</p>
                                <p className="text-hackclub-slate text-sm mt-1">Add credits to get started</p>
                            </div>
                        ) : (
                            <div className="divide-y-2 divide-hackclub-smoke">
                                <AnimatePresence initial={false}>
                                    {transactions.map((transaction, index) => (
                                        <motion.div
                                            key={transaction.id}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: index * 0.03 }}
                                            className="px-6 py-4 flex items-center gap-4 hover:bg-hackclub-smoke/30 transition-colors"
                                        >
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                transaction.type === 'deposit'
                                                    ? 'bg-hackclub-green text-white'
                                                    : 'bg-hackclub-red text-white'
                                            }`}>
                                                {transaction.type === 'deposit' ? (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                                    </svg>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-hackclub-dark truncate">{transaction.description}</p>
                                                <p className="text-xs text-hackclub-muted">{formatDate(transaction.timestamp)}</p>
                                            </div>
                                            <p className={`font-black text-lg flex-shrink-0 ${
                                                transaction.amount > 0 ? 'text-hackclub-green' : 'text-hackclub-red'
                                            }`}>
                                                {transaction.amount > 0 ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)}
                                            </p>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            </div>
        </div>
    );
};

export default CreditsPage;
