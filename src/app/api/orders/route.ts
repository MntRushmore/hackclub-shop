import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../auth/[...nextauth]/route';
import { Order } from '../../../types/Order';
import { rateLimit, rateLimitResponse } from '../../../lib/rateLimit';
import { CreditTransaction } from '../../../types/Credits';
import { PointsTransaction } from '../../../types/Points';
import { validateCSRFToken } from '../../../lib/csrf';
import { validateCartItems } from '../../../lib/productValidation';

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

// POST - Create a new order (requires full payment via credits)
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

    try {
        const { items, cashTotal, pointsRequired, shippingCost, shippingCountry, shippingPaymentCash, shippingPaymentPoints, checkoutData, csrfToken, idempotencyKey, couponDiscount = 0 } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number; pointsSpent?: number }[];
            cashTotal: number;
            pointsRequired: number;
            shippingCost?: number | string;
            shippingPaymentCash?: number;
            shippingPaymentPoints?: number;
            shippingCountry?: string;
            checkoutData?: Record<string, string>;
            csrfToken?: string;
            idempotencyKey?: string;
            couponDiscount?: number;
        };

        const shippingCostNum = typeof shippingCost === 'string' ? parseFloat(shippingCost) : (shippingCost || 0);
        const couponDiscountNum = typeof couponDiscount === 'string' ? parseFloat(couponDiscount as any) : (couponDiscount || 0);

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

        const verifiedItemCashTotal = validation.verifiedTotal!;
        const verifiedItemPointsTotal = validation.verifiedPointsTotal || 0;

        // Handle shipping payment breakdown (default to all cash if not provided)
        const verifiedShippingCashPayment = shippingPaymentCash ?? shippingCostNum;
        const verifiedShippingPointsPayment = shippingPaymentPoints ?? 0;

        // Verify shipping payment breakdown adds up to shipping cost
        const shippingPaymentTotal = verifiedShippingCashPayment + verifiedShippingPointsPayment;
        if (Math.abs(shippingPaymentTotal - shippingCostNum) > 0.01) {
            return NextResponse.json({
                error: 'Shipping payment breakdown is invalid.',
                expectedShippingTotal: shippingCostNum,
                providedShippingTotal: shippingPaymentTotal,
                shippingCash: verifiedShippingCashPayment,
                shippingPoints: verifiedShippingPointsPayment
            }, { status: 400 });
        }

        const verifiedCashTotal = Math.max(0, verifiedItemCashTotal - couponDiscountNum + verifiedShippingCashPayment);
        const verifiedPointsTotal = verifiedItemPointsTotal + verifiedShippingPointsPayment;

        if (Math.abs(verifiedCashTotal - cashTotal) > 0.01 || verifiedPointsTotal !== pointsRequired) {
            return NextResponse.json({
                error: 'Price mismatch detected. Please refresh your cart.',
                expectedCash: verifiedCashTotal,
                providedCash: cashTotal,
                expectedPoints: verifiedPointsTotal,
                providedPoints: pointsRequired,
                itemsCashTotal: verifiedItemCashTotal,
                shippingCost: shippingCostNum,
                shippingPaymentCash: verifiedShippingCashPayment,
                shippingPaymentPoints: verifiedShippingPointsPayment,
                couponDiscount: couponDiscountNum
            }, { status: 400 });
        }

        // Check user has enough balances
        const [creditsBalanceRaw, pointsBalanceRaw] = await Promise.all([
            redis.get<number>(`user:${userId}:balance`),
            redis.get<number>(`user:${userId}:pointsBalance`),
        ]);

        const creditsBalance = creditsBalanceRaw ?? 0;
        const pointsBalance = pointsBalanceRaw ?? 0;

        if (pointsBalance < verifiedItemPointsTotal) {
            return NextResponse.json({
                error: 'Insufficient points',
                required: verifiedItemPointsTotal,
                balance: pointsBalance
            }, { status: 400 });
        }

        if (creditsBalance < verifiedCashTotal) {
            return NextResponse.json({
                error: 'Insufficient credits',
                required: verifiedCashTotal,
                balance: creditsBalance
            }, { status: 400 });
        }

        // Create order with verified items
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();
        const order: Order = {
            id: orderId,
            userId,
            items: validation.items!.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                thumbnail_url: item.thumbnail_url,
            })),
            subtotal: verifiedItemCashTotal,
            pointsRequired: verifiedItemPointsTotal,
            pointsSpent: verifiedItemPointsTotal,
            couponDiscount: couponDiscountNum > 0 ? couponDiscountNum : undefined,
            shippingCost: shippingCostNum,
            totalAmount: verifiedCashTotal,
            creditsPaid: verifiedCashTotal,
            shippingCountry,
            checkoutData: checkoutData || {},
            status: 'pending',
            statusHistory: [
                { status: 'pending', timestamp: now }
            ],
            createdAt: now,
        };

        // Deduct balances
        const newCreditsBalance = creditsBalance - verifiedCashTotal;
        const newPointsBalance = pointsBalance - verifiedItemPointsTotal;

        const currentCreditTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];
        const currentPointsTransactions = await redis.get<PointsTransaction[]>(`user:${userId}:pointsTransactions`) || [];

        const creditTransaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -verifiedCashTotal,
            type: 'purchase',
            description: `Order #${orderId.slice(-8)}`,
            timestamp: new Date(),
            orderId,
        };

        const pointsTransaction: PointsTransaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -verifiedItemPointsTotal,
            type: 'spend',
            description: `Order #${orderId.slice(-8)}`,
            timestamp: new Date(),
            orderId,
        };

        const newCreditTransactions = [creditTransaction, ...currentCreditTransactions];
        const newPointsTransactions = [pointsTransaction, ...currentPointsTransactions];

        // Save everything atomically
        const currentOrders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        const newOrders = [order, ...currentOrders];

        const savePromises: Promise<unknown>[] = [
            redis.set(`user:${userId}:balance`, newCreditsBalance),
            redis.set(`user:${userId}:transactions`, newCreditTransactions),
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

        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/slack/notify-purchase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: order.id,
                    userId,
                    userEmail: session.user?.email,
                    slackId: (session.user as any)?.slackId,
                    items: order.items,
                    subtotal: order.subtotal,
                    couponDiscount: order.couponDiscount,
                    totalAmount: order.totalAmount,
                    shippingCost: order.shippingCost,
                    shippingCountry: order.shippingCountry,
                    checkoutData: order.checkoutData,
                    newBalance: newCreditsBalance,
                    pointsSpent: order.pointsSpent,
                    newPointsBalance: newPointsBalance,
                }),
            });
        } catch (error) {
            console.error('Failed to notify Slack about purchase:', error);
        }

        return NextResponse.json({
            order,
            creditsBalance: newCreditsBalance,
            pointsBalance: newPointsBalance,
            creditTransaction,
            pointsTransaction,
        });
    } catch (error) {
        console.error('[Orders API] Error creating order:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
