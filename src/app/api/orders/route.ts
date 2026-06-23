import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../auth/[...nextauth]/route';
import { Order, ShippingAddress } from '../../../types/Order';
import { isStructuredAddress, validateAddress } from '../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../lib/rateLimit';
import { PointsTransaction } from '../../../types/Points';
import { validateCSRFToken } from '../../../lib/csrf';
import { validateCartItems } from '../../../lib/productValidation';
import { commitImmediate, restock, StockLine } from '../../../lib/inventory';
import { mirrorOrder, mirrorUser } from '../../../lib/airtableMirror';
import { sendEmail, buildOrderConfirmation, buildAdminNewOrder } from '../../../lib/email';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// GET - Fetch user's orders
export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 30 requests per minute
    const rateLimitResult = await rateLimit(`orders:get:${userId}`, { maxRequests: 30, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const orders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        return NextResponse.json({ orders });
    } catch (error) {
        console.error('[Orders API] Error fetching orders:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

// POST - Create a new student order (paid entirely in points).
// Adult/guest orders go through the HCB donation checkout route instead.
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 5 orders per minute
    const rateLimitResult = await rateLimit(`orders:post:${userId}`, { maxRequests: 5, windowMs: 60000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    // Stock decremented for this attempt; restocked if the order then fails to save.
    let committedStock: StockLine[] | null = null;
    try {
        const { items, pointsRequired, shippingCountry, shippingPointsCost, checkoutData, csrfToken, idempotencyKey } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number }[];
            pointsRequired: number;
            shippingPointsCost?: number;
            shippingCountry?: string;
            checkoutData?: Record<string, string | ShippingAddress>;
            csrfToken?: string;
            idempotencyKey?: string;
        };

        const shippingPointsNum = typeof shippingPointsCost === 'number' ? shippingPointsCost : 0;

        // Validate CSRF token
        if (csrfToken) {
            const csrfValid = await validateCSRFToken(csrfToken);
            if (!csrfValid) {
                return NextResponse.json({ error: 'Invalid security token. Please refresh and try again.' }, { status: 403 });
            }
        }

        // Check idempotency - prevent duplicate orders
        if (idempotencyKey) {
            const existingOrder = await redis.get<string>(`idempotency:${userId}:${idempotencyKey}`);
            if (existingOrder) {
                return NextResponse.json({ error: 'Order already processed', orderId: existingOrder }, { status: 409 });
            }
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'No items in order' }, { status: 400 });
        }

        // Ensure all variant_ids are strings for consistent validation
        const itemsWithStringVariantId = items.map(item => ({
            ...item,
            variant_id: item.variant_id !== undefined && item.variant_id !== null ? String(item.variant_id) : undefined,
        }));

        // Validate products and prices server-side
        const validation = await validateCartItems(itemsWithStringVariantId);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const verifiedItemPointsTotal = validation.verifiedPointsTotal || 0;

        // Every item a student buys must be points-priced.
        const nonPointsItem = validation.items!.find(i => !i.pricePoints || i.pricePoints <= 0);
        if (nonPointsItem) {
            return NextResponse.json({ error: `${nonPointsItem.name} can't be bought with points.` }, { status: 400 });
        }

        const verifiedPointsTotal = verifiedItemPointsTotal + shippingPointsNum;

        if (verifiedPointsTotal !== pointsRequired) {
            return NextResponse.json({
                error: 'Points total mismatch. Please refresh your cart.',
                expectedPoints: verifiedPointsTotal,
                providedPoints: pointsRequired,
                itemsPointsTotal: verifiedItemPointsTotal,
                shippingPointsCost: shippingPointsNum,
            }, { status: 400 });
        }

        const pointsBalance = (await redis.get<number>(`user:${userId}:pointsBalance`)) ?? 0;

        if (pointsBalance < verifiedPointsTotal) {
            return NextResponse.json({
                error: 'Insufficient points',
                required: verifiedPointsTotal,
                balance: pointsBalance
            }, { status: 400 });
        }

        // Decrement stock immediately — points orders settle in-request, so there's
        // no reservation window. Fails closed before any points are deducted; if
        // anything below throws, we release the units so they aren't leaked.
        const stockLines: StockLine[] = validation.items!.map(i => ({ variantId: i.variantId, quantity: i.quantity }));
        const stockResult = await commitImmediate(stockLines);
        if (!stockResult.ok) {
            const oversold = validation.items!.find(i => i.variantId === stockResult.variantId);
            const name = oversold?.name || 'An item';
            return NextResponse.json(
                {
                    error: stockResult.available > 0
                        ? `Only ${stockResult.available} of ${name} left — please reduce the quantity.`
                        : `${name} just sold out.`,
                },
                { status: 409 },
            );
        }
        committedStock = stockLines;

        // Extract + validate the structured shipping address (if present in checkoutData).
        let shippingAddress: ShippingAddress | undefined;
        for (const value of Object.values(checkoutData || {})) {
            if (isStructuredAddress(value)) {
                shippingAddress = value as ShippingAddress;
                break;
            }
        }
        if (shippingAddress) {
            const addrErrors = validateAddress(shippingAddress);
            if (addrErrors.length > 0) {
                return NextResponse.json({ error: addrErrors[0] }, { status: 400 });
            }
        }
        // Prefer the address's country for shipping when available.
        const resolvedShippingCountry = shippingAddress?.country || shippingCountry;

        // Create order with verified items
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();
        const order: Order = {
            id: orderId,
            userId,
            pathway: 'student',
            paymentMethod: 'points',
            paymentStatus: 'paid',
            items: validation.items!.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                thumbnail_url: item.thumbnail_url,
                // Finance: capture variant + cost basis at sale time for COGS.
                variantId: item.variantId,
                unitCost: item.unitCost,
            })),
            subtotal: 0,
            pointsRequired: verifiedPointsTotal,
            pointsSpent: verifiedPointsTotal,
            shippingCost: 0,
            shippingPointsCost: shippingPointsNum,
            totalAmount: 0,
            creditsPaid: 0,
            shippingCountry: resolvedShippingCountry,
            shippingAddress,
            checkoutData: checkoutData || {},
            status: 'pending',
            statusHistory: [
                { status: 'pending', timestamp: now }
            ],
            createdAt: now,
        };

        // Deduct points
        const newPointsBalance = pointsBalance - verifiedPointsTotal;

        const currentPointsTransactions = await redis.get<PointsTransaction[]>(`user:${userId}:pointsTransactions`) || [];

        const pointsTransaction: PointsTransaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -verifiedPointsTotal,
            type: 'spend',
            description: `Order #${orderId.slice(-8)}`,
            timestamp: new Date(),
            orderId,
        };

        const newPointsTransactions = [pointsTransaction, ...currentPointsTransactions];

        // Save everything atomically
        const currentOrders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        const newOrders = [order, ...currentOrders];

        const savePromises: Promise<unknown>[] = [
            redis.set(`user:${userId}:pointsBalance`, newPointsBalance),
            redis.set(`user:${userId}:pointsTransactions`, newPointsTransactions),
            redis.set(`user:${userId}:orders`, newOrders),
        ];

        const slackId = (session.user as any)?.slackId;
        if (slackId) {
            savePromises.push(redis.set(`user:${userId}:slackId`, slackId));
        }

        // Store idempotency key for 24 hours
        if (idempotencyKey) {
            savePromises.push(redis.set(`idempotency:${userId}:${idempotencyKey}`, orderId, { ex: 86400 }));
        }

        await Promise.all(savePromises);

        // Best-effort mirror to Airtable for staff visibility (never blocks the order).
        void mirrorOrder(order, slackId);
        void mirrorUser({ userId, pointsBalance: newPointsBalance, slackId, email: session.user?.email ?? undefined });

        // Confirm to the student + alert staff (no-op until email is configured).
        const studentEmail = session.user?.email ?? undefined;
        if (studentEmail) void sendEmail(buildOrderConfirmation(order, studentEmail));
        const adminMsg = buildAdminNewOrder(order);
        if (adminMsg) void sendEmail(adminMsg);

        return NextResponse.json({
            order,
            pointsBalance: newPointsBalance,
            pointsTransaction,
        });
    } catch (error) {
        console.error('[Orders API] Error creating order:', error);
        // If we'd already decremented stock for this attempt, give it back so a
        // failed save doesn't strand units. restock() is best-effort/no-throw.
        if (committedStock) void restock(committedStock);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
