export interface OrderItem {
    id: string;
    name: string;
    price: string;
    quantity: number;
    thumbnail_url?: string;
}

/**
 * Structured shipping address. Field names mirror the Stripe Address object
 * (line1/line2/city/state/postal_code/country) so a future payment integration
 * can map to it directly. `name` holds the recipient name.
 */
export interface ShippingAddress {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string; // ISO 3166-1 alpha-2 (e.g. "US")
}

export interface OrderStatusUpdate {
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    timestamp: Date;
    message?: string;
}

export interface Order {
    id: string;
    userId: string;
    items: OrderItem[];
    subtotal: number;
    pointsRequired: number;
    pointsSpent: number;
    couponDiscount?: number;
    shippingCost: number;
    totalAmount: number; // cash component
    creditsPaid: number; // cash paid with credits
    shippingCountry?: string;
    shippingAddress?: ShippingAddress;
    checkoutData: Record<string, string | ShippingAddress>;
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
}
