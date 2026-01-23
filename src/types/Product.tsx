export type PaymentMode = 'balance_only' | 'points_only' | 'mixed';

export interface Variant {
    id: number;
    variant_id: number;
    name: string;
    retail_price: string;
    payment_mode: PaymentMode;
    price_balance?: number;
    price_points?: number;
    price_balance_full?: number;
    price_points_full?: number;
    size: string;
    color: string;
    product: {
        image: string;
    };
}

export interface Product {
    id: number;
    name: string;
    thumbnail_url: string;
    sync_variants?: Variant[];
}

export interface ProductDetail {
    id: number;
    name: string;
    thumbnail_url: string;
    sync_variants?: Variant[];
    external_id?: string;
    variants?: number;
    synced?: number;
    is_ignored?: boolean;
}
