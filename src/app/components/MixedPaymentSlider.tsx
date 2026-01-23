'use client';

import React, { useState, useEffect } from 'react';
import { calculateMixedPayment } from '../../lib/paymentUtils';

interface MixedPaymentSliderProps {
    priceBalanceFull: number;
    pricePointsFull: number;
    userBalance: number;
    userPoints: number;
    quantity: number;
    onPointsChange: (points: number) => void;
}

export const MixedPaymentSlider: React.FC<MixedPaymentSliderProps> = ({
    priceBalanceFull = 0,
    pricePointsFull = 0,
    userBalance = 0,
    userPoints = 0,
    quantity = 1,
    onPointsChange,
}) => {
    const [pointsPerUnit, setPointsPerUnit] = useState(0);
    const maxPointsPerUnit = Math.max(0, pricePointsFull || 0);

    const { pointsToCharge: pointsPerUnitCharged, balanceToCharge: balancePerUnitCharged } =
        calculateMixedPayment(pointsPerUnit, priceBalanceFull, pricePointsFull);

    const totalPointsNeeded = pointsPerUnitCharged * quantity;
    const totalBalanceNeeded = balancePerUnitCharged * quantity;

    const hasEnoughBalance = userBalance >= totalBalanceNeeded;
    const hasEnoughPoints = userPoints >= totalPointsNeeded;
    const canCheckout = hasEnoughBalance && hasEnoughPoints;

    useEffect(() => {
        onPointsChange(pointsPerUnit);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pointsPerUnit]);

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPointsPerUnit(Math.floor(parseFloat(e.target.value)));
    };

    const handleMaxPoints = () => {
        setPointsPerUnit(maxPointsPerUnit);
    };

    const handleAllBalance = () => {
        setPointsPerUnit(0);
    };

    return (
        <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Balance per unit:</span>
                    <span className="font-semibold">${balancePerUnitCharged.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Points per unit:</span>
                    <span className="font-semibold">{pointsPerUnitCharged}</span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between">
                    <span className="text-gray-600 font-medium">Total (×{quantity}):</span>
                    <div className="text-right">
                        <div className="font-semibold">
                            ${totalBalanceNeeded.toFixed(2)} + {totalPointsNeeded} pts
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                    Points per unit: {pointsPerUnit} / {maxPointsPerUnit}
                </label>
                <input
                    type="range"
                    min="0"
                    max={maxPointsPerUnit}
                    value={pointsPerUnit}
                    onChange={handleSliderChange}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>

            <div className="flex gap-2">
                <button
                    onClick={handleAllBalance}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium transition ${
                        pointsPerUnit === 0
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    All Balance
                </button>
                <button
                    onClick={handleMaxPoints}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium transition ${
                        pointsPerUnit === maxPointsPerUnit
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Max Points
                </button>
            </div>

            <div className="space-y-1 text-sm">
                {!hasEnoughBalance && (
                    <div className="flex items-center text-red-600">
                        <span className="mr-2">✗</span>
                        Insufficient balance (need ${totalBalanceNeeded.toFixed(2)}, have ${userBalance.toFixed(2)})
                    </div>
                )}
                {!hasEnoughPoints && (
                    <div className="flex items-center text-red-600">
                        <span className="mr-2">✗</span>
                        Insufficient points (need {totalPointsNeeded}, have {userPoints})
                    </div>
                )}
                {canCheckout && (
                    <div className="flex items-center text-green-600">
                        <span className="mr-2">✓</span>
                        You can complete this purchase
                    </div>
                )}
            </div>
        </div>
    );
};
