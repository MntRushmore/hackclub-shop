export interface OrderItem {
    id: string;
    name: string;
    price: string;
    quantity: number;
    thumbnail_url?: string;
    // Finance: the variant sold and its cost basis (USD per unit) captured at the
    // moment of sale, so cost-of-goods stays point-in-time even if the variant's
    // standard cost changes later. Both optional — orders predating the finance
    // layer (or lines that can't be mapped to a variant) simply omit them, and
    // reporting falls back to the variant's current cost, flagged as estimated.
    variantId?: string;
    unitCost?: number;
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

/**
 * Shipment record for a fulfilled order. Populated when staff buy postage —
 * either through the EasyPost/Pirate Ship integration (`src/lib/shipping.ts`)
 * or by pasting a tracking number bought manually in Pirate Ship. EasyPost is
 * what Pirate Ship runs on, so a label bought either way maps to these fields.
 */
export interface OrderShipment {
    carrier?: string;          // e.g. "USPS", "UPS"
    service?: string;          // e.g. "First", "Priority"
    trackingNumber?: string;
    trackingUrl?: string;      // public carrier/EasyPost tracking page
    labelUrl?: string;         // postage label PDF/PNG (EasyPost-hosted)
    easypostShipmentId?: string;
    cost?: number;             // postage paid, USD (for the audit/stats trail)
    estDeliveryDate?: string;  // ISO date string when known
    shippedAt?: Date;
    // Set when the customer chose+paid a live EasyPost rate at checkout, so admin
    // fulfillment can buy that exact label. Not yet purchased.
    chosenRateId?: string;
    chosenAtCheckout?: boolean;
}

/** Which storefront an order came through. */
export type OrderPathway = 'student' | 'guest';
/**
 * How the order was paid. `stripe` is the current guest cash path (a Stripe
 * Checkout card payment; Stripe Tax computes sales tax). `hcb` is retained for
 * orders placed during the HCB-donation era so they still read correctly.
 */
export type OrderPaymentMethod = 'points' | 'stripe' | 'hcb';
/** Settlement state of the money/points charge. */
export type OrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';

/**
 * HCB donation linkage for a guest order. The donation is made on HCB's hosted
 * page (`donationUrl`, pre-filled with the order's amount + a `utm_content` tag
 * carrying the order id). Reconciliation polls the HCB v4 transactions API and,
 * on a match, records the matched transaction id + the donation timestamp.
 */
export interface OrderHcb {
    donationUrl?: string;   // the pre-filled /donations/start URL handed to the donor
    donationTxId?: string;  // HCB v4 transaction id once the donation is matched
    donatedAt?: string;     // ISO timestamp of the matched donation (HCB's donated_at)
}

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
    totalAmount: number;         // cash total charged (USD); set to Stripe's amount_total (incl. tax) once paid
    taxAmount?: number;          // sales tax charged (USD), from Stripe Tax; absent on points/HCB/pre-tax orders
    creditsPaid: number;         // legacy; always 0 now that credits are retired
    // Stripe linkage (current guest cash path).
    stripeSessionId?: string;
    stripePaymentIntentId?: string;
    // HCB donation linkage — guest orders placed during the HCB-donation era.
    hcb?: OrderHcb;
    shippingCountry?: string;
    shippingAddress?: ShippingAddress;
    // Postage/tracking, set at fulfillment time (Pirate Ship / EasyPost).
    shipment?: OrderShipment;
    // Units reserved against inventory for this order (guest/Stripe path). The
    // webhook commits these on payment or releases them if the session expires.
    inventoryHold?: { variantId: string; quantity: number }[];
    checkoutData: Record<string, string | ShippingAddress>;
    status: 'pending' | 'approved' | 'fulfilled' | 'denied' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
    // When true, the order is a test/junk order: hidden from the default admin
    // list and excluded from stats/revenue. Toggleable by admins.
    isTest?: boolean;
}
