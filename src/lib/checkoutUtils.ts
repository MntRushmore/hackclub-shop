import { createHash } from 'crypto';

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

/**
 * Stable fingerprint of a cart + destination so a shipping quote can be bound to
 * exactly the order it was priced for. A live EasyPost rate is only re-validated
 * for existence at checkout; without binding it to the cart weight + address, a
 * shopper could quote a light/cheap shipment and reuse its rate id for a heavier
 * order. The fingerprint normalizes ordering (sort by id+variant) so the client
 * can reorder lines without breaking the match.
 */
export function cartAddressFingerprint(
    items: { id: string | number; variant_id?: string | number | null; quantity?: number }[],
    address: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | undefined,
): string {
    const normItems = items
        .map(i => ({
            id: String(i.id),
            v: i.variant_id != null ? String(i.variant_id) : '',
            q: Math.max(1, Math.trunc(Number(i.quantity) || 1)),
        }))
        .sort((a, b) => (a.id + a.v).localeCompare(b.id + b.v));
    const normAddr = address
        ? [address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
            .map(s => (s || '').trim().toLowerCase())
            .join('|')
        : '';
    const payload = JSON.stringify({ items: normItems, addr: normAddr });
    return createHash('sha256').update(payload).digest('hex').slice(0, 32);
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
