'use client';

import React from 'react';
import { calculateItemCost, inferPaymentMode } from '../../lib/paymentUtils';

interface CartItemPriceProps {
    paymentMode?: string;
    priceBalance?: number;
    pricePoints?: number;
    priceBalanceFull?: number;
    pricePointsFull?: number;
    quantity: number;
    pointsSpent?: number;
    price?: string;
    pointsPrice?: number;
}

export const CartItemPrice: React.FC<CartItemPriceProps> = ({
    paymentMode,
    priceBalance,
    pricePoints,
    priceBalanceFull,
    pricePointsFull,
    quantity,
    pointsSpent,
    price,
    pointsPrice,
}) => {
    const variantData = {
        id: 0,
        variant_id: 0,
        name: '',
        retail_price: price || '',
        payment_mode: paymentMode,
        price_balance: priceBalance,
        price_points: pricePoints,
        price_balance_full: priceBalanceFull,
        price_points_full: pricePointsFull,
        points_price: pointsPrice,
        size: '',
        color: '',
        product: { image: '' },
    };
    
    const cost = calculateItemCost(variantData, quantity, pointsSpent);

    const mode = paymentMode || inferPaymentMode(variantData);
    
    if (!cost || cost.balanceNeeded === 0 && cost.pointsNeeded === 0) {
        const numPrice = parseFloat(price || '0');
        return (
            <div className="text-right">
                {numPrice > 0 && <div className="font-semibold text-gray-900">${numPrice.toFixed(2)}</div>}
                {pointsPrice && pointsPrice > 0 && <div className="font-semibold text-gray-900">{pointsPrice} pts</div>}
                {numPrice === 0 && !pointsPrice && <div className="font-semibold text-gray-900">Free</div>}
            </div>
        );
    }

    return (
        <div className="text-right">
            {mode === 'balance_only' && (
                <div className="font-semibold text-gray-900">
                    ${cost.balanceNeeded.toFixed(2)}
                </div>
            )}
            {mode === 'points_only' && (
                <div className="font-semibold text-gray-900">
                    {cost.pointsNeeded} points
                </div>
            )}
            {mode === 'mixed' && (
                <div className="font-semibold text-gray-900 text-sm space-y-1">
                    {cost.balanceNeeded > 0 && <div>${cost.balanceNeeded.toFixed(2)}</div>}
                    {cost.pointsNeeded > 0 && <div className="text-blue-600">{cost.pointsNeeded} pts</div>}
                </div>
            )}
            {(cost.balanceNeeded === 0 && cost.pointsNeeded === 0) && (
                <div className="font-semibold text-gray-900">Free</div>
            )}
        </div>
    );
};
