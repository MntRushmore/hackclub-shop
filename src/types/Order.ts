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
    couponDiscount?: number;
    shippingCost: number;
    totalAmount: number;
    creditsPaid: number;
    shippingCountry?: string;
    checkoutData: Record<string, string>;
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
}
