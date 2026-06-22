interface CartItem {
    id: string | number;
    name: string;
    price: string;
    price_cash?: number;
    price_points?: number;
    thumbnail_url: string;
    variant_id?: string | number | null;
    quantity: number;
}

export interface CheckoutSummary {
    totalCash: number;
    totalPoints: number;
}

export function buildCheckoutSummary(cartItems: CartItem[]): CheckoutSummary {
    let totalCash = 0;
    let totalPoints = 0;

    for (const item of cartItems) {
        totalCash += (item.price_cash ?? 0) * item.quantity;
        totalPoints += (item.price_points ?? 0) * item.quantity;
    }

    return {
        totalCash: parseFloat(totalCash.toFixed(2)),
        totalPoints,
    };
}

export function validatePointsCheckout(
    totalPoints: number,
    userPoints: number
): { valid: boolean; error?: string } {
    if (userPoints < totalPoints) {
        return {
            valid: false,
            error: `Insufficient points (need ${totalPoints}, have ${userPoints})`,
        };
    }

    return { valid: true };
}
