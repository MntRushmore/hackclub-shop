export interface OrderItem {
    id: string;
    name: string;
    price: string;
    quantity: number;
    thumbnail_url?: string;
}

export interface Order {
    id: string;
    userId: string;
    items: OrderItem[];
    totalAmount: number;
    creditsPaid: number;
    status: 'pending' | 'completed' | 'cancelled';
    createdAt: Date;
}
