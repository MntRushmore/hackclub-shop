export interface OrderItem {
    id: string;
    name: string;
    price: string;
    quantity: number;
    thumbnail_url?: string;
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
    checkoutData: Record<string, string>;
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
}
