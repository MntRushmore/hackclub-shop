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

/** Which storefront an order came through. */
export type OrderPathway = 'student' | 'guest';
/** How the order was paid. */
export type OrderPaymentMethod = 'points' | 'stripe';
/** Settlement state of the money/points charge. */
export type OrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface Order {
    id: string;
    userId: string; // Hack Club user id for students; '' / guest email for guests
    pathway: OrderPathway;
    paymentMethod: OrderPaymentMethod;
    paymentStatus: OrderPaymentStatus;
    guestEmail?: string; // set for guest (Stripe) orders
    items: OrderItem[];
    subtotal: number;
    pointsRequired: number;
    pointsSpent: number;
    couponDiscount?: number;
    shippingCost: number;        // USD shipping (guest/Stripe orders)
    shippingPointsCost?: number; // points shipping (student orders)
    totalAmount: number;         // cash total charged (USD)
    creditsPaid: number;         // legacy; always 0 now that credits are retired
    // Stripe linkage (guest orders only).
    stripeSessionId?: string;
    stripePaymentIntentId?: string;
    shippingCountry?: string;
    shippingAddress?: ShippingAddress;
    checkoutData: Record<string, string | ShippingAddress>;
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
    // When true, the order is a test/junk order: hidden from the default admin
    // list and excluded from stats/revenue. Toggleable by admins.
    isTest?: boolean;
}
