'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ShippingPaymentSelectorProps {
    itemPaymentMode: 'balance_only' | 'points_only' | 'mixed';
    shippingCost: number;
    itemsCashTotal: number;
    itemsPointsTotal: number;
    userBalance: number;
    userPoints: number;
    onPaymentMethodChange: (method: 'balance_only' | 'points_only' | 'mixed', breakdown: { cashTotal: number, pointsTotal: number }) => void;
}

export const ShippingPaymentSelector: React.FC<ShippingPaymentSelectorProps> = ({
    itemPaymentMode,
    shippingCost,
    itemsCashTotal,
    itemsPointsTotal,
    userBalance,
    userPoints,
    onPaymentMethodChange,
}) => {
    // Determine what shipping payment modes are available based on item payment mode
    const canPayShippingWithBalance = itemPaymentMode !== 'points_only';
    const canPayShippingWithPoints = itemPaymentMode !== 'balance_only';

    const [shippingPaymentMode, setShippingPaymentMode] = useState<'balance_only' | 'points_only' | 'mixed'>(() => {
        // Default based on item payment mode
        if (itemPaymentMode === 'balance_only') return 'balance_only';
        if (itemPaymentMode === 'points_only') return 'points_only';
        return 'balance_only'; // Default for mixed items
    });

    const [shippingPointsRatio, setShippingPointsRatio] = useState(0); // 0 = all balance, 1 = all points

    useEffect(() => {
        // Reset shipping payment mode if item mode changed
        if (itemPaymentMode === 'balance_only' && shippingPaymentMode !== 'balance_only') {
            setShippingPaymentMode('balance_only');
        }
        if (itemPaymentMode === 'points_only' && shippingPaymentMode !== 'points_only') {
            setShippingPaymentMode('points_only');
        }
    }, [itemPaymentMode, shippingPaymentMode]);

    // Calculate shipping costs based on payment mode
    const getShippingBreakdown = () => {
        if (shippingPaymentMode === 'balance_only') {
            return { balance: shippingCost, points: 0 };
        }
        if (shippingPaymentMode === 'points_only') {
            // Convert shipping cost to points at 1:1 ratio (or use your conversion rate)
            return { balance: 0, points: Math.round(shippingCost * 100) }; // Assuming 100 points = $1
        }
        // Mixed mode - slider between balance and points
        const balanceAmount = shippingCost * (1 - shippingPointsRatio);
        const pointsAmount = Math.round(shippingCost * shippingPointsRatio * 100);
        return { balance: balanceAmount, points: pointsAmount };
    };

    const shippingBreakdown = getShippingBreakdown();
    const totalCashRequired = itemsCashTotal + shippingBreakdown.balance;
    const totalPointsRequired = itemsPointsTotal + shippingBreakdown.points;

    const hasEnoughBalance = userBalance >= totalCashRequired;
    const hasEnoughPoints = userPoints >= totalPointsRequired;

    useEffect(() => {
        onPaymentMethodChange(shippingPaymentMode, {
            cashTotal: totalCashRequired,
            pointsTotal: totalPointsRequired,
        });
    }, [shippingPaymentMode, shippingPointsRatio, itemsCashTotal, itemsPointsTotal]);

    return (
        <div className="bg-hackclub-smoke/20 rounded-2xl p-4 space-y-4">
            <div>
                <p className="font-bold text-hackclub-dark mb-3">Shipping Payment</p>

                {/* Show options based on what's available */}
                {canPayShippingWithBalance && canPayShippingWithPoints ? (
                    // Both options available - show buttons
                    <div className="space-y-3">
                        <button
                            onClick={() => {
                                setShippingPaymentMode('balance_only');
                                setShippingPointsRatio(0);
                            }}
                            className={`w-full py-2 px-4 rounded-lg font-bold transition ${shippingPaymentMode === 'balance_only'
                                    ? 'bg-hackclub-blue text-white'
                                    : 'bg-white border-2 border-hackclub-smoke text-hackclub-dark hover:border-hackclub-blue'
                                }`}
                        >
                            Pay with Credits (${shippingCost.toFixed(2)})
                        </button>

                        <button
                            onClick={() => {
                                setShippingPaymentMode('points_only');
                                setShippingPointsRatio(1);
                            }}
                            className={`w-full py-2 px-4 rounded-lg font-bold transition ${shippingPaymentMode === 'points_only'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white border-2 border-hackclub-smoke text-hackclub-dark hover:border-blue-500'
                                }`}
                        >
                            Pay with Points ({Math.round(shippingCost * 100)} pts)
                        </button>

                        <button
                            onClick={() => {
                                setShippingPaymentMode('mixed');
                                setShippingPointsRatio(0.5);
                            }}
                            className={`w-full py-2 px-4 rounded-lg font-bold transition ${shippingPaymentMode === 'mixed'
                                    ? 'bg-purple-500 text-white'
                                    : 'bg-white border-2 border-hackclub-smoke text-hackclub-dark hover:border-purple-500'
                                }`}
                        >
                            Mix Credits & Points
                        </button>
                    </div>
                ) : canPayShippingWithBalance ? (
                    <div className="px-4 py-2 bg-hackclub-blue/10 rounded-lg border-2 border-hackclub-blue">
                        <p className="font-bold text-hackclub-dark text-sm">
                            Shipping: ${shippingCost.toFixed(2)} (Credits only)
                        </p>
                    </div>
                ) : (
                    <div className="px-4 py-2 bg-blue-500/10 rounded-lg border-2 border-blue-500">
                        <p className="font-bold text-hackclub-dark text-sm">
                            Shipping: {Math.round(shippingCost * 100)} pts (Points only)
                        </p>
                    </div>
                )}
            </div>

            {/* Slider for mixed mode */}
            <AnimatePresence>
                {shippingPaymentMode === 'mixed' && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-3 pt-3 border-t border-hackclub-smoke"
                    >
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-hackclub-dark">
                                Points Ratio: {Math.round(shippingPointsRatio * 100)}%
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round(shippingPointsRatio * 100)}
                                onChange={(e) => setShippingPointsRatio(parseInt(e.target.value) / 100)}
                                className="w-full h-2 bg-hackclub-smoke rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                        </div>
                        <div className="text-sm space-y-1">
                            <div className="flex justify-between">
                                <span className="text-hackclub-slate">Credits:</span>
                                <span className="font-bold text-hackclub-dark">${shippingBreakdown.balance.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-hackclub-slate">Points:</span>
                                <span className="font-bold text-hackclub-dark">{shippingBreakdown.points} pts</span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Summary */}
            <div className="pt-2 border-t border-hackclub-smoke space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-hackclub-slate">Items + Shipping (Credits):</span>
                    <span className={`font-bold ${hasEnoughBalance ? 'text-hackclub-dark' : 'text-hackclub-red'}`}>
                        ${totalCashRequired.toFixed(2)} {!hasEnoughBalance && `(need $${(totalCashRequired - userBalance).toFixed(2)} more)`}
                    </span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-hackclub-slate">Points Required:</span>
                    <span className={`font-bold ${hasEnoughPoints ? 'text-hackclub-dark' : 'text-hackclub-red'}`}>
                        {totalPointsRequired} pts {!hasEnoughPoints && `(need ${totalPointsRequired - userPoints} more)`}
                    </span>
                </div>
            </div>
        </div>
    );
};
