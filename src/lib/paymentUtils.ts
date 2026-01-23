import { Variant, PaymentMode } from '../types/Product';

export function inferPaymentMode(variant: any): PaymentMode {
    if (variant.payment_mode) {
        return variant.payment_mode;
    }
    
    const hasBalance = variant.retail_price || variant.price_balance;
    const hasPoints = variant.points_price || variant.price_points;
    
    if (hasBalance && hasPoints) {
        return 'mixed';
    } else if (hasPoints && !hasBalance) {
        return 'points_only';
    }
    return 'balance_only';
}

export function getDisplayPrice(variant: any): string {
    const mode = variant.payment_mode || inferPaymentMode(variant);
    
    switch (mode) {
        case 'balance_only':
            return `$${(variant.price_balance || parseFloat(variant.retail_price || '0')).toFixed(2)}`;
        case 'points_only':
            return `${variant.price_points || variant.points_price || 0} points`;
        case 'mixed':
            const balance = variant.price_balance_full || parseFloat(variant.retail_price || '0');
            const points = variant.price_points_full || variant.points_price || 0;
            return `$${balance.toFixed(2)} or ${points} points`;
    }
}

export function getPaymentModeBadge(mode: PaymentMode | string | undefined): string {
    const m = (mode || 'balance_only') as PaymentMode;
    switch (m) {
        case 'balance_only':
            return 'Balance only';
        case 'points_only':
            return 'Points only';
        case 'mixed':
            return 'Use balance, points, or both';
        default:
            return 'Balance only';
    }
}

export function calculateMixedPayment(
    pointsSpent: number,
    priceBalanceFull: number,
    pricePointsFull: number
): { pointsToCharge: number; balanceToCharge: number } {
    const maxPoints = Math.max(1, pricePointsFull);
    const actualPointsSpent = Math.min(Math.max(pointsSpent, 0), maxPoints);

    const ratio = pricePointsFull > 0 ? actualPointsSpent / pricePointsFull : 0;

    const balanceCharged = priceBalanceFull * (1 - ratio);

    return {
        pointsToCharge: actualPointsSpent,
        balanceToCharge: parseFloat(balanceCharged.toFixed(2)),
    };
}

export interface CartItemCost {
    balanceNeeded: number;
    pointsNeeded: number;
}

export function calculateItemCost(
    variant: any,
    quantity: number,
    pointsSpent?: number
): CartItemCost {
    const mode = variant.payment_mode || inferPaymentMode(variant);
    
    const perUnit = (() => {
        switch (mode) {
            case 'balance_only':
                return {
                    balanceNeeded: variant.price_balance || parseFloat(variant.retail_price || '0'),
                    pointsNeeded: 0,
                };
            case 'points_only':
                return {
                    balanceNeeded: 0,
                    pointsNeeded: variant.price_points || variant.points_price || 0,
                };
            case 'mixed':
                const points = pointsSpent ?? 0;
                const balanceFull = variant.price_balance_full || parseFloat(variant.retail_price || '0');
                const pointsFull = variant.price_points_full || variant.points_price || 0;
                const { pointsToCharge, balanceToCharge } = calculateMixedPayment(
                    points,
                    balanceFull,
                    pointsFull
                );
                return {
                    balanceNeeded: balanceToCharge,
                    pointsNeeded: pointsToCharge,
                };
        }
    })();

    return {
        balanceNeeded: parseFloat((perUnit.balanceNeeded * quantity).toFixed(2)),
        pointsNeeded: Math.round(perUnit.pointsNeeded * quantity),
    };
}
