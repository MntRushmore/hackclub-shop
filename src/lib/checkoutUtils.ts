interface CartItem {
    id: string | number;
    name: string;
    price: string;
    paymentMode: 'balance_only' | 'points_only' | 'mixed';
    priceBalance?: number;
    pricePoints?: number;
    priceBalanceFull?: number;
    pricePointsFull?: number;
    pointsSpent?: number;
    thumbnail_url: string;
    variant_id?: string | number | null;
    quantity: number;
}
import { calculateItemCost } from './paymentUtils';

export interface CheckoutSummary {
    items: Array<{
        name: string;
        quantity: number;
        paymentMode: string;
        balanceNeeded: number;
        pointsNeeded: number;
    }>;
    totalBalance: number;
    totalPoints: number;
}

export function buildCheckoutSummary(cartItems: CartItem[]): CheckoutSummary {
    let totalBalance = 0;
    let totalPoints = 0;

    const items = cartItems.map((item) => {
        const cost = calculateItemCost(
            {
                id: 0,
                variant_id: 0,
                name: item.name,
                retail_price: item.price,
                payment_mode: item.paymentMode,
                price_balance: item.priceBalance,
                price_points: item.pricePoints,
                price_balance_full: item.priceBalanceFull,
                price_points_full: item.pricePointsFull,
                size: '',
                color: '',
                product: { image: '' },
            },
            item.quantity,
            item.pointsSpent
        );

        totalBalance += cost.balanceNeeded;
        totalPoints += cost.pointsNeeded;

        return {
            name: item.name,
            quantity: item.quantity,
            paymentMode: item.paymentMode,
            balanceNeeded: cost.balanceNeeded,
            pointsNeeded: cost.pointsNeeded,
        };
    });

    return {
        items,
        totalBalance: parseFloat(totalBalance.toFixed(2)),
        totalPoints,
    };
}

export function validateCheckout(
    summary: CheckoutSummary,
    userBalance: number,
    userPoints: number
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (userBalance < summary.totalBalance) {
        errors.push(
            `Insufficient HCB balance (need €${summary.totalBalance.toFixed(2)}, have €${userBalance.toFixed(2)})`
        );
    }

    if (userPoints < summary.totalPoints) {
        errors.push(
            `Insufficient points (need ${summary.totalPoints}, have ${userPoints})`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function formatCheckoutSummary(summary: CheckoutSummary): string {
    const parts: string[] = [];

    if (summary.totalBalance > 0) {
        parts.push(`€${summary.totalBalance.toFixed(2)}`);
    }

    if (summary.totalPoints > 0) {
        parts.push(`${summary.totalPoints} points`);
    }

    return parts.length > 0 ? parts.join(' + ') : 'Free';
}
