/**
 * Best-effort, write-through mirror of live Redis data into Airtable so staff
 * can VIEW everything in the Airtable UI. Redis remains the source of truth;
 * Airtable is a read-only mirror.
 *
 * Every function here is fire-and-forget safe: failures are logged and
 * swallowed, never thrown, so a flaky Airtable call can never break a purchase
 * or any other write path. Callers should `void mirrorX(...)` (or await in a
 * try/catch) — they must not depend on the result.
 *
 * Tables (create these in the configured base; field names are Title Case):
 *   Products  — keyed on "Product Id"
 *   Orders    — keyed on "Order Id"
 *   Users     — keyed on "User Id"
 *   Coupons   — keyed on "Coupon Id"
 */

import { Order } from '../types/Order';
import { Product } from '../types/Admin';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLES = {
    products: process.env.AIRTABLE_PRODUCTS_TABLE || 'Products',
    orders: process.env.AIRTABLE_ORDERS_TABLE || 'Orders',
    users: process.env.AIRTABLE_USERS_TABLE || 'Users',
    coupons: process.env.AIRTABLE_COUPONS_TABLE || 'Coupons',
} as const;

const isConfigured = () => Boolean(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);

function tableUrl(table: string) {
    return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

async function airtable(path: string, init: RequestInit) {
    const res = await fetch(path, {
        ...init,
        headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Airtable ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
}

/**
 * Find an existing record id by matching a key field, so we can upsert
 * (Airtable has no native upsert keyed on a non-record-id field).
 */
async function findRecordId(table: string, keyField: string, keyValue: string): Promise<string | null> {
    // Escape single quotes for the formula string.
    const safe = keyValue.replace(/'/g, "\\'");
    const formula = encodeURIComponent(`{${keyField}}='${safe}'`);
    const data = await airtable(`${tableUrl(table)}?filterByFormula=${formula}&maxRecords=1`, { method: 'GET' });
    return data.records?.[0]?.id ?? null;
}

async function upsert(table: string, keyField: string, keyValue: string, fields: Record<string, unknown>) {
    const existingId = await findRecordId(table, keyField, keyValue);
    if (existingId) {
        await airtable(`${tableUrl(table)}/${existingId}`, {
            method: 'PATCH',
            body: JSON.stringify({ fields }),
        });
    } else {
        await airtable(tableUrl(table), {
            method: 'POST',
            body: JSON.stringify({ records: [{ fields }], typecast: true }),
        });
    }
}

async function removeByKey(table: string, keyField: string, keyValue: string) {
    const existingId = await findRecordId(table, keyField, keyValue);
    if (existingId) {
        await airtable(`${tableUrl(table)}/${existingId}`, { method: 'DELETE' });
    }
}

/** Wrap a mirror op so it never throws into the caller. */
function safe(label: string, fn: () => Promise<void>): Promise<void> {
    if (!isConfigured()) return Promise.resolve();
    return fn().catch((err) => {
        console.error(`[airtableMirror] ${label} failed:`, err instanceof Error ? err.message : err);
    });
}

// ── Products ────────────────────────────────────────────────────────────────

export function mirrorProduct(product: Product): Promise<void> {
    return safe(`product ${product.id}`, () =>
        upsert(TABLES.products, 'Product Id', product.id, {
            'Product Id': product.id,
            Name: product.name,
            Description: product.description || '',
            Category: product.category || '',
            'Image URL': product.image_url || '',
            'Thumbnail URL': product.thumbnail_url || '',
            'Variants JSON': JSON.stringify(product.variants || []),
            'Shipping Options JSON': JSON.stringify(product.shippingOptions || []),
            'Variant Count': (product.variants || []).length,
            'Updated At': new Date().toISOString(),
        }),
    );
}

export function unmirrorProduct(productId: string): Promise<void> {
    return safe(`delete product ${productId}`, () => removeByKey(TABLES.products, 'Product Id', productId));
}

// ── Orders ───────────────────────────────────────────────────────────────────

export function mirrorOrder(order: Order, slackId?: string): Promise<void> {
    return safe(`order ${order.id}`, () =>
        upsert(TABLES.orders, 'Order Id', order.id, {
            'Order Id': order.id,
            'User Id': order.userId,
            'Slack Id': slackId || '',
            Status: order.status,
            'Items JSON': JSON.stringify(order.items || []),
            'Item Summary': (order.items || []).map((i) => `${i.quantity}x ${i.name}`).join(', '),
            Subtotal: order.subtotal,
            'Points Spent': order.pointsSpent,
            'Coupon Discount': order.couponDiscount ?? 0,
            'Shipping Cost': order.shippingCost,
            'Total Amount': order.totalAmount,
            'Credits Paid': order.creditsPaid,
            'Shipping Country': order.shippingCountry || '',
            'Checkout Data JSON': JSON.stringify(order.checkoutData || {}),
            'Status History JSON': JSON.stringify(order.statusHistory || []),
            'Created At': new Date(order.createdAt).toISOString(),
        }),
    );
}

// ── Users (balance + points snapshot) ─────────────────────────────────────────

export function mirrorUser(args: {
    userId: string;
    balance?: number;
    pointsBalance?: number;
    slackId?: string;
    email?: string;
    adminRole?: string;
}): Promise<void> {
    const fields: Record<string, unknown> = {
        'User Id': args.userId,
        'Updated At': new Date().toISOString(),
    };
    if (args.balance !== undefined) fields['Balance'] = args.balance;
    if (args.pointsBalance !== undefined) fields['Points Balance'] = args.pointsBalance;
    if (args.slackId) fields['Slack Id'] = args.slackId;
    if (args.email) fields['Email'] = args.email;
    if (args.adminRole) fields['Admin Role'] = args.adminRole;

    return safe(`user ${args.userId}`, () => upsert(TABLES.users, 'User Id', args.userId, fields));
}

// ── Coupons ───────────────────────────────────────────────────────────────────

export function mirrorCoupon(coupon: {
    id: string;
    code: string;
    discountType: string;
    discountValue: number;
    usageType: string;
    usageLimit?: number;
    usageCount: number;
    active: boolean;
    expiresAt?: Date | string;
}): Promise<void> {
    return safe(`coupon ${coupon.id}`, () =>
        upsert(TABLES.coupons, 'Coupon Id', coupon.id, {
            'Coupon Id': coupon.id,
            Code: coupon.code,
            'Discount Type': coupon.discountType,
            'Discount Value': coupon.discountValue,
            'Usage Type': coupon.usageType,
            'Usage Limit': coupon.usageLimit ?? null,
            'Usage Count': coupon.usageCount,
            Active: coupon.active,
            'Expires At': coupon.expiresAt ? new Date(coupon.expiresAt).toISOString() : null,
        }),
    );
}

export function unmirrorCoupon(couponId: string): Promise<void> {
    return safe(`delete coupon ${couponId}`, () => removeByKey(TABLES.coupons, 'Coupon Id', couponId));
}
