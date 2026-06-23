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
    },
    store_manager: {
        canManageUsers: false,
        canManageBalance: false,
        canManageCoupons: false,
        canManageProducts: true,
        canViewStats: true,
        canManageAdmins: false,
        canManageFinance: false,
    },
    reader: {
        canManageUsers: false,
        canManageBalance: false,
        canManageCoupons: false,
        canManageProducts: false,
        canViewStats: true,
        canManageAdmins: false,
        canManageFinance: false,
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
