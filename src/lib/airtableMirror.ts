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
import { Vendor, Quote, PurchaseOrder, Asset } from '../types/Sourcing';
import { formatAddress } from './address';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLES = {
    products: process.env.AIRTABLE_PRODUCTS_TABLE || 'Products',
    orders: process.env.AIRTABLE_ORDERS_TABLE || 'Orders',
    users: process.env.AIRTABLE_USERS_TABLE || 'Users',
    coupons: process.env.AIRTABLE_COUPONS_TABLE || 'Coupons',
    vendors: process.env.AIRTABLE_VENDORS_TABLE || 'Vendors',
    quotes: process.env.AIRTABLE_QUOTES_TABLE || 'Quotes',
    purchaseOrders: process.env.AIRTABLE_POS_TABLE || 'Purchase Orders',
    assets: process.env.AIRTABLE_ASSETS_TABLE || 'Assets',
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

async function writeRecord(table: string, existingId: string | null, fields: Record<string, unknown>) {
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

async function upsert(table: string, keyField: string, keyValue: string, fields: Record<string, unknown>) {
    const existingId = await findRecordId(table, keyField, keyValue);
    const payload = { ...fields };

    // Self-heal against schema drift: if a field doesn't exist in the table yet,
    // drop it and retry so the rest of the record still syncs. Bounded retries.
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            await writeRecord(table, existingId, payload);
            return;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const match = msg.match(/Unknown field name: "([^"]+)"/);
            if (match && match[1] in payload) {
                delete payload[match[1]];
                console.warn(`[airtableMirror] dropping unknown field "${match[1]}" on ${table}`);
                continue;
            }
            throw err;
        }
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
            // Convenience roll-up so staff can scan stock without parsing the JSON.
            // Per-variant stock lives inside Variants JSON (the sync reads it there).
            'Total Stock': (product.variants || []).reduce(
                (sum, v) => sum + (typeof v.stock === 'number' ? v.stock : 0),
                0,
            ),
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
            Pathway: order.pathway,
            'Payment Method': order.paymentMethod,
            'Payment Status': order.paymentStatus,
            'Guest Email': order.guestEmail || '',
            'Is Test': order.isTest ? true : false,
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
            'Shipping Address': order.shippingAddress ? formatAddress(order.shippingAddress) : '',
            'Shipping Address JSON': order.shippingAddress ? JSON.stringify(order.shippingAddress) : '',
            Carrier: order.shipment?.carrier || '',
            'Tracking Number': order.shipment?.trackingNumber || '',
            'Tracking URL': order.shipment?.trackingUrl || '',
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

// ── Vendors ───────────────────────────────────────────────────────────────────

export function mirrorVendor(vendor: Vendor): Promise<void> {
    return safe(`vendor ${vendor.id}`, () =>
        upsert(TABLES.vendors, 'Vendor Id', vendor.id, {
            'Vendor Id': vendor.id,
            Name: vendor.name,
            Website: vendor.website || '',
            'Contact Name': vendor.contactName || '',
            'Contact Email': vendor.contactEmail || '',
            Tags: (vendor.tags || []).join(', '),
            Notes: vendor.notes || '',
            'Created At': vendor.createdAt,
            'Updated At': vendor.updatedAt,
        }),
    );
}

export function unmirrorVendor(vendorId: string): Promise<void> {
    return safe(`delete vendor ${vendorId}`, () => removeByKey(TABLES.vendors, 'Vendor Id', vendorId));
}

// ── Quotes ────────────────────────────────────────────────────────────────────

export function mirrorQuote(quote: Quote): Promise<void> {
    // Cheapest tier (highest minQty wins ties is irrelevant here) for a scannable
    // "from $X" roll-up; the full tier table lives in Price Breaks JSON.
    const cheapest = (quote.priceBreaks || []).reduce<number | null>(
        (min, b) => (min === null || b.unitCost < min ? b.unitCost : min),
        null,
    );
    return safe(`quote ${quote.id}`, () =>
        upsert(TABLES.quotes, 'Quote Id', quote.id, {
            'Quote Id': quote.id,
            'Vendor Id': quote.vendorId,
            'Item Name': quote.itemName,
            'Product Id': quote.productId || '',
            'Variant Hint': quote.variantHint || '',
            'Price Breaks JSON': JSON.stringify(quote.priceBreaks || []),
            'Lowest Unit Cost': cheapest ?? null,
            MOQ: quote.moq ?? null,
            'Lead Time Days': quote.leadTimeDays ?? null,
            'Setup Fee': quote.setupFee ?? null,
            'Shipping Estimate': quote.shippingEstimate ?? null,
            Currency: quote.currency || 'USD',
            'Valid Until': quote.validUntil || null,
            Status: quote.status,
            Notes: quote.notes || '',
            'Created At': quote.createdAt,
            'Updated At': quote.updatedAt,
        }),
    );
}

export function unmirrorQuote(quoteId: string): Promise<void> {
    return safe(`delete quote ${quoteId}`, () => removeByKey(TABLES.quotes, 'Quote Id', quoteId));
}

// ── Purchase Orders ────────────────────────────────────────────────────────────

export function mirrorPurchaseOrder(po: PurchaseOrder): Promise<void> {
    const lineTotal = (po.lines || []).reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
    const total = lineTotal + (po.setupFee || 0) + (po.shippingCost || 0);
    return safe(`po ${po.id}`, () =>
        upsert(TABLES.purchaseOrders, 'PO Id', po.id, {
            'PO Id': po.id,
            'Vendor Id': po.vendorId,
            'Quote Id': po.quoteId || '',
            Status: po.status,
            'Lines JSON': JSON.stringify(po.lines || []),
            'Line Summary': (po.lines || []).map((l) => `${l.quantity}× ${l.description}`).join(', '),
            'Units Total': (po.lines || []).reduce((sum, l) => sum + l.quantity, 0),
            'Setup Fee': po.setupFee ?? null,
            'Shipping Cost': po.shippingCost ?? null,
            'Total Cost': Math.round(total * 100) / 100,
            'Expected Date': po.expectedDate || null,
            'Received Receipt Ids': (po.receivedReceiptIds || []).join(', '),
            'Issued By': po.issuedBy || '',
            'Created At': po.createdAt,
            'Updated At': po.updatedAt,
        }),
    );
}

export function unmirrorPurchaseOrder(poId: string): Promise<void> {
    return safe(`delete po ${poId}`, () => removeByKey(TABLES.purchaseOrders, 'PO Id', poId));
}

// ── Assets (design / art files) ────────────────────────────────────────────────

export function mirrorAsset(asset: Asset): Promise<void> {
    return safe(`asset ${asset.id}`, () =>
        upsert(TABLES.assets, 'Asset Id', asset.id, {
            'Asset Id': asset.id,
            Filename: asset.filename,
            Label: asset.label || '',
            Kind: asset.kind,
            Version: asset.version,
            'Group Id': asset.assetGroupId,
            'Mime Type': asset.mimeType,
            URL: asset.blobUrl,
            'Product Id': asset.productId || '',
            'Variant Id': asset.variantId || '',
            'Quote Id': asset.quoteId || '',
            'PO Id': asset.poId || '',
            'Uploaded By': asset.uploadedBy,
            'Created At': asset.createdAt,
        }),
    );
}

export function unmirrorAsset(assetId: string): Promise<void> {
    return safe(`delete asset ${assetId}`, () => removeByKey(TABLES.assets, 'Asset Id', assetId));
}
