'use client';

import { useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditsContext } from '../../context/CreditsContext';

const CreditsPage = () => {
    const creditsContext = useContext(CreditsContext);
    const [showAddCredits, setShowAddCredits] = useState(false);

    if (!creditsContext) return null;

    const { balance, transactions, addCredits } = creditsContext;

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleSimulateHCBPayment = (amount: number) => {
        addCredits(amount, `HCB Payment - $${amount.toFixed(2)}`);
        setShowAddCredits(false);
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
                                    onClick={() => setShowAddCredits(false)}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl p-6 shadow-2xl z-[10002] w-full max-w-sm mx-4"
                                >
                                    <h2 className="text-2xl font-black text-hackclub-dark mb-1">Add Credits</h2>
                                    <p className="text-hackclub-slate text-sm mb-5">
                                        Pay via HCB to add credits to your account
                                    </p>

                                    <div className="bg-hackclub-smoke rounded-xl p-4 mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-hackclub-red rounded-lg flex items-center justify-center flex-shrink-0">
                                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="font-bold text-hackclub-dark text-sm">HCB Integration</p>
                                                <p className="text-xs text-hackclub-muted">Coming soon</p>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide mb-2">Quick add (for testing)</p>
                                    <div className="grid grid-cols-3 gap-2 mb-5">
                                        {[10, 25, 50].map((amount) => (
                                            <motion.button
                                                key={amount}
                                                whileHover={{ scale: 1.03 }}
                                                whileTap={{ scale: 0.97 }}
                                                onClick={() => handleSimulateHCBPayment(amount)}
                                                className="bg-hackclub-smoke hover:bg-hackclub-red hover:text-white text-hackclub-dark font-black py-3 rounded-xl transition-all text-lg"
                                            >
                                                ${amount}
                                            </motion.button>
                                        ))}
                                    </div>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setShowAddCredits(false)}
                                        className="w-full bg-hackclub-dark hover:bg-hackclub-slate text-white font-bold py-3 rounded-full transition-colors"
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
