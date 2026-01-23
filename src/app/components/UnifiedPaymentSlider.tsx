'use client';

import React, { useState, useEffect } from 'react';
import { calculateMixedPayment } from '../../lib/paymentUtils';

interface UnifiedPaymentSliderProps {
    item: any;
    shippingCost: number;
    shippingCostPoints: number;
    couponDiscount: number;
    userBalance: number;
    userPoints: number;
    onPointsChange: (points: number) => void;
    onShippingPaymentChange: (cashTotal: number, pointsTotal: number) => void;
}

export const UnifiedPaymentSlider: React.FC<UnifiedPaymentSliderProps> = ({
    item,
    shippingCost,
    shippingCostPoints,
    couponDiscount,
    userBalance,
    userPoints,
    onPointsChange,
    onShippingPaymentChange,
}) => {
    // Total points available to spend across items and shipping
    const totalPointsCostFull = (item.pricePointsFull || 0) * item.quantity + (shippingCostPoints || 0);
    const totalCashCostFull = (item.priceBalanceFull || 0) * item.quantity + shippingCost - couponDiscount;

    // User controls how many total points to "throw in"
    const [totalPointsSpent, setTotalPointsSpent] = useState(0);

    // Allocate points: first to items, then to shipping
    const itemPointsMaxPerUnit = item.pricePointsFull || 0;
    const itemPointsMaxTotal = itemPointsMaxPerUnit * item.quantity;

    let itemPointsSpent = Math.min(totalPointsSpent, itemPointsMaxTotal);
    let shippingPointsSpent = Math.max(0, totalPointsSpent - itemPointsSpent);

    // Calculate balance costs based on points spent
    const { pointsToCharge: itemPointsCharged, balanceToCharge: itemBalancePerUnitCharged } =
        calculateMixedPayment(itemPointsSpent / item.quantity, item.priceBalanceFull, item.pricePointsFull);

    const itemBalanceTotalCharged = itemBalancePerUnitCharged * item.quantity;

    // For shipping, calculate how much cash discount we get from points spent
    // If user spends X shipping points out of Y shipping points total, reduce shipping cost proportionally
    const shippingPointsRatio = shippingCostPoints > 0 ? Math.min(1, shippingPointsSpent / shippingCostPoints) : 0;
    const shippingBalanceCharged = Math.max(0, shippingCost * (1 - shippingPointsRatio));

    const totalCashRequired = itemBalanceTotalCharged + shippingBalanceCharged;
    const totalPointsRequired = itemPointsCharged * item.quantity + shippingPointsSpent;

    const hasEnoughBalance = userBalance >= totalCashRequired;
    const hasEnoughPoints = userPoints >= totalPointsRequired;

    useEffect(() => {
        onPointsChange(itemPointsSpent / item.quantity);
    }, [itemPointsSpent, item.quantity]);

    useEffect(() => {
        onShippingPaymentChange(totalCashRequired, totalPointsRequired);
    }, [totalCashRequired, totalPointsRequired]);

    return (
        <div className="space-y-4 bg-white rounded-lg p-4 border border-hackclub-smoke">
            <p className="font-bold text-hackclub-dark text-sm">{item.name}</p>

            {/* Breakdown */}
            <div className="space-y-2 text-sm bg-hackclub-smoke/20 rounded-lg p-3">
                <div className="flex justify-between text-hackclub-slate">
                    <span>Item + Shipping (Cash):</span>
                    <span className="font-semibold text-hackclub-dark">${totalCashRequired.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-hackclub-slate">
                    <span>Item + Shipping (Points):</span>
                    <span className="font-semibold text-hackclub-dark">{totalPointsRequired} pts</span>
                </div>
                <div className="border-t border-hackclub-smoke pt-2 flex justify-between">
                    <span className="font-bold text-hackclub-dark">Points Available to Spend:</span>
                    <span className="font-bold text-hackclub-dark">{totalPointsCostFull} pts</span>
                </div>
            </div>

            {/* Main Slider */}
            <div className="space-y-3 pt-3 border-t border-hackclub-smoke">
                <div>
                    <label className="block text-sm font-bold text-hackclub-dark mb-3">
                        Points to Spend: {totalPointsSpent} / {totalPointsCostFull} pts
                    </label>
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min="0"
                            max={totalPointsCostFull}
                            value={totalPointsSpent}
                            onChange={(e) => setTotalPointsSpent(Math.floor(parseFloat(e.target.value)))}
                            className="flex-1 h-2 bg-hackclub-smoke rounded-lg appearance-none cursor-pointer accent-hackclub-blue"
                            style={{
                                background: `linear-gradient(to right, #ff0000 0%, #ff0000 ${totalPointsCostFull > 0 ? (totalPointsSpent / totalPointsCostFull) * 100 : 0
                                    }%, #e8e8e8 ${totalPointsCostFull > 0 ? (totalPointsSpent / totalPointsCostFull) * 100 : 0
                                    }%, #e8e8e8 100%)`,
                            }}
                        />
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => setTotalPointsSpent(0)}
                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition ${totalPointsSpent === 0
                                ? 'bg-hackclub-blue text-white'
                                : 'bg-hackclub-smoke/50 text-hackclub-dark hover:bg-hackclub-smoke'
                                }`}
                        >
                            No Points
                        </button>
                        <button
                            onClick={() => setTotalPointsSpent(totalPointsCostFull)}
                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition ${totalPointsSpent === totalPointsCostFull
                                ? 'bg-hackclub-blue text-white'
                                : 'bg-hackclub-smoke/50 text-hackclub-dark hover:bg-hackclub-smoke'
                                }`}
                        >
                            Max Points
                        </button>
                    </div>
                </div>

                {/* Points Allocation Breakdown */}
                {totalPointsSpent > 0 && (
                    <div className="space-y-2 text-sm bg-hackclub-blue/5 rounded-lg p-3 border border-hackclub-blue/20">
                        <p className="font-bold text-hackclub-dark">Points Allocation:</p>
                        <div className="flex justify-between text-hackclub-slate">
                            <span>→ Item:</span>
                            <span className="font-semibold text-hackclub-dark">{itemPointsSpent} pts</span>
                        </div>
                        <div className="flex justify-between text-hackclub-slate">
                            <span>→ Shipping:</span>
                            <span className="font-semibold text-hackclub-dark">{shippingPointsSpent} pts</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Validation Messages */}
            <div className="space-y-1 text-sm pt-2 border-t border-hackclub-smoke">
                {!hasEnoughBalance && (
                    <div className="flex items-center text-hackclub-red">
                        <svg
                            className="w-4 h-4 mr-2 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                        Need ${(totalCashRequired - userBalance).toFixed(2)} more credits
                    </div>
                )}
                {!hasEnoughPoints && (
                    <div className="flex items-center text-hackclub-red">
                        <svg
                            className="w-4 h-4 mr-2 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                        Need {totalPointsRequired - userPoints} more points
                    </div>
                )}
                {hasEnoughBalance && hasEnoughPoints && (
                    <div className="flex items-center text-hackclub-green">
                        <svg
                            className="w-4 h-4 mr-2 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        You can complete this purchase
                    </div>
                )}
            </div>
        </div>
    );
};
