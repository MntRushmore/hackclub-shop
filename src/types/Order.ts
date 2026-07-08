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
    status: 'received' | 'fulfilled' | 'delivered' | 'refunded';
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
    trackerId?: string;        // EasyPost tracker id; the delivery webhook matches on this
    cost?: number;             // postage paid, USD (for the audit/stats trail)
    estDeliveryDate?: string;  // ISO date string when known
    shippedAt?: Date;
    deliveredAt?: Date;        // set when the carrier confirms delivery (tracker webhook / manual)
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

/**
 * Donation-tier summary for an order that contains donation-tier items (the
 * shop's donation pivot: donate at a tier, merch is the thank-you gift).
 * Amounts are USD, captured at checkout from the verified catalog prices — the
 * receipt email turns this into the IRS quid-pro-quo acknowledgment, and the
 * donor wall (Slice 3) reads displayName/dedication/isAnonymous from here.
 */
export interface OrderDonation {
    tier: string;             // tier name of the largest donation line, e.g. "Philanthropist"
    fundId: string;           // DonationFund id the donor directed the money to
    amount: number;           // total donated across donation lines (USD)
    fmvAmount: number;        // fair market value of the thank-you gifts (USD)
    deductibleAmount: number; // amount minus fmvAmount, floored at 0 (USD)
    dedication?: string;      // "in honor of Maya"
    displayName?: string;     // donor-wall name, e.g. "The Chen Family"
    isAnonymous?: boolean;
    // Legacy: the numbered-vest program (retired 2026-07) minted a 1–100 number
    // at settlement. Kept so old orders' receipts and packing slips still show it.
    vestNumber?: number;
    // True when the donation is a monthly subscription (first payment recorded
    // here; renewals bump the impact counters via the invoice.paid webhook).
    recurring?: boolean;
    // ISO timestamp when the employer-match follow-up email went out (set by the
    // match-followup cron; absent = not yet sent).
    matchEmailSentAt?: string;
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
    // Which Stripe key slot created the session ('live' when absent — orders
    // predate the toggle). Refunds must go through the same slot, and 'test'
    // orders are also stamped isTest so every aggregate ignores them.
    stripeMode?: 'live' | 'test';
    // HCB donation linkage — guest orders placed during the HCB-donation era.
    hcb?: OrderHcb;
    // Donation-tier summary — set when the cart contained donation-tier items.
    donation?: OrderDonation;
    shippingCountry?: string;
    shippingAddress?: ShippingAddress;
    // Postage/tracking, set at fulfillment time (Pirate Ship / EasyPost).
    shipment?: OrderShipment;
    // Units reserved against inventory for this order (guest/Stripe path). The
    // webhook commits these on payment or releases them if the session expires.
    inventoryHold?: { variantId: string; quantity: number }[];
    checkoutData: Record<string, string | ShippingAddress>;
    status: 'received' | 'fulfilled' | 'delivered' | 'refunded';
    statusHistory: OrderStatusUpdate[];
    createdAt: Date;
    // When true, the order is a test/junk order: hidden from the default admin
    // list and excluded from stats/revenue. Toggleable by admins.
    isTest?: boolean;
}
