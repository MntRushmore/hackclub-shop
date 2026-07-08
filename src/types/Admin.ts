import type { DonationTierConfig } from '../lib/donation';

export type AdminRole = 'manager' | 'store_manager' | 'reader';

export interface AdminUser {
    userId: string;
    role: AdminRole;
    invitedBy?: string;
    invitedAt?: Date;
}

export interface AdminPermissions {
    canManageUsers: boolean;
    canManageBalance: boolean;
    canManageCoupons: boolean;
    canManageProducts: boolean;
    canViewStats: boolean;
    canManageAdmins: boolean;
    // Finance: view cost/margin/valuation data and record stock receipts. Kept
    // separate from canViewStats (order stats) and canManageProducts so cost
    // basis and margin are only visible to finance-trusted roles.
    canManageFinance: boolean;
    // Sourcing: manage vendors, quotes, purchase orders, and design assets. Cost
    // basis shown inside the sourcing tools is still gated by canManageFinance, so
    // a store_manager can run procurement without seeing margins.
    canManageSourcing: boolean;
}

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermissions> = {
    manager: {
        canManageUsers: true,
        canManageBalance: true,
        canManageCoupons: true,
        canManageProducts: true,
        canViewStats: true,
        canManageAdmins: true,
        canManageFinance: true,
        canManageSourcing: true,
    },
    store_manager: {
        canManageUsers: false,
        canManageBalance: false,
        canManageCoupons: false,
        canManageProducts: true,
        canViewStats: true,
        canManageAdmins: false,
        canManageFinance: false,
        canManageSourcing: true,
    },
    reader: {
        canManageUsers: false,
        canManageBalance: false,
        canManageCoupons: false,
        canManageProducts: false,
        canViewStats: true,
        canManageAdmins: false,
        canManageFinance: false,
        canManageSourcing: false,
    },
};

export interface ProductVariant {
    id: string;
    variant_id: string;
    name: string;
    price: number; // legacy USD field, kept for backward-compat reads
    // Dual pricing. A variant is buyable on a pathway iff its price is set.
    price_cash?: number;   // USD — adult/Stripe path
    price_points?: number; // points — student path
    size?: string;
    color?: string;
    image_url?: string;
    stock?: number;
    weightOz?: number; // shipping weight per unit (oz), for live EasyPost rates
    // Finance: current standard cost per unit (USD) — what we pay for one. Set by
    // hand or recomputed as a weighted average when stock is received (see
    // src/lib/costing.ts). Drives inventory valuation and COGS. Missing = uncosted.
    unitCost?: number;
    // Sourcing: when available stock falls to/below this, the variant is flagged for
    // reorder (command center / reorder intelligence). Optional; unset = no reorder
    // signal. Does not affect checkout or availability.
    reorderPoint?: number;
    // Barcode identity: a human-readable, store-wide-unique SKU (e.g. HC-STICKER-3IN-RED)
    // that is PRINTED on this variant's label and read by humans. Resolution back to a
    // variant uses the `sku:{sku}` reverse index (see src/lib/sku.ts). Optional; unset =
    // not yet labeled. Non-secret (it lives on physical product) — never embed
    // price/cost/PII. Does not affect checkout, pricing, or availability.
    sku?: string;
    // The SHORT code actually ENCODED in the barcode (e.g. HC-1042). Long SKUs make a
    // Code 128 too wide to fit/scan on a 4in label, so the barcode carries this compact
    // code and the human-readable SKU prints as text. Minted alongside the SKU and
    // indexed at `scancode:{code}`. A scan resolves via either the code or the full SKU.
    scanCode?: string;
    // Stripe Tax product code for this variant (e.g. clothing txcd_30011000 —
    // tax-exempt in Vermont — vs the general tangible-goods default). Rides in
    // Price metadata `tax_code`; checkout uses it to classify the line.
    taxCode?: string;
    // Donation tiers: declared fair market value of this gift (integer cents),
    // in Price metadata `fmv_cents`. Lets checkout bill each chosen gift as its
    // own FMV line; unset falls back to the tier-level donation.fmvCents.
    fmvCents?: number;
}

export interface ShippingOption {
    id: string;
    country: string;
    cost: number;
    costPoints?: number;
}

export type CheckoutFieldType = 'text' | 'email' | 'phone' | 'address' | 'textarea';

export interface CheckoutField {
    id: string;
    name: string;
    label: string;
    type: CheckoutFieldType;
    required: boolean;
}

export interface Product {
    id: string;
    name: string;
    description: string;
    thumbnail_url?: string;
    image_url?: string;
    category?: string;
    variants: ProductVariant[];
    shippingOptions: ShippingOption[];
    checkoutFields: CheckoutField[];
    // Donation pivot: present iff this product is a donation tier — the cash
    // price is the donation amount and the merch is the thank-you gift. Carried
    // here so admin/import round-trips through toStripeProduct don't drop it.
    donation?: DonationTierConfig;
    // Sourcing pipeline: a product created from an accepted quote starts as a draft.
    // Drafts are excluded from the storefront (`/api/products`) until an admin
    // publishes them (sets prices + clears the flag in the product editor). Existing
    // products have no flag and render as before.
    draft?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface Coupon {
    id: string;
    code: string;
    discountType: 'percentage' | 'fixed';
    discountValue: number;
    usageType: 'single' | 'reusable' | 'limited';
    usageLimit?: number;
    usageCount: number;
    applicableProducts?: string[];
    active: boolean;
    createdAt: Date;
    expiresAt?: Date;
}
