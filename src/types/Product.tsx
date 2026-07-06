export interface Variant {
    id: number;
    variant_id: number;
    name: string;
    retail_price: string;
    // Dual pricing: a variant is available to a pathway iff that price is set.
    // price_cash (USD) → adult/Stripe path; price_points → student path.
    price_cash?: number;
    price_points?: number;
    available?: number | null; // null = unlimited; number = units left
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
    description?: string;
    thumbnail_url: string;
    sync_variants?: Variant[];
    external_id?: string;
    variants?: number;
    synced?: number;
    is_ignored?: boolean;
    // Donation tier marker (see src/lib/donation.ts): the cash price is the
    // donation amount; the merch is the thank-you gift.
    donation?: { tier: string; fmvCents: number; impact?: string } | null;
}
