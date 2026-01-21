import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../auth/[...nextauth]/route';
import { Order } from '../../../types/Order';
import { rateLimit, rateLimitResponse } from '../../../lib/rateLimit';
import { CreditTransaction } from '../../../types/Credits';
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
        const { items, totalAmount, csrfToken, idempotencyKey } = await request.json() as { 
            items: { id: string; name: string; price: string; quantity: number; variant_id?: number }[]; 
            totalAmount: number;
            csrfToken?: string;
            idempotencyKey?: string;
        };

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

        // Validate products and prices server-side
        const validation = await validateCartItems(items);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        // Use server-verified total, not client-provided
        const verifiedTotal = validation.verifiedTotal!;

        if (Math.abs(verifiedTotal - totalAmount) > 0.01) {
            return NextResponse.json({ 
                error: 'Price mismatch detected. Please refresh your cart.',
                expectedTotal: verifiedTotal,
                providedTotal: totalAmount
            }, { status: 400 });
        }

        // Check user has enough credits
        const currentBalance = await redis.get<number>(`user:${userId}:balance`) || 0;

        if (currentBalance < verifiedTotal) {
            return NextResponse.json({ 
                error: 'Insufficient credits', 
                required: verifiedTotal,
                balance: currentBalance 
            }, { status: 400 });
        }

        // Create order with verified items
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            totalAmount: verifiedTotal,
            creditsPaid: verifiedTotal,
            status: 'completed',
            createdAt: new Date(),
        };

        // Deduct credits
        const newBalance = currentBalance - verifiedTotal;
        const currentTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];
        
        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -verifiedTotal,
            type: 'purchase',
            description: `Order #${orderId.slice(-8)}`,
            timestamp: new Date(),
            orderId,
        };

        const newTransactions = [transaction, ...currentTransactions];

        // Save everything atomically
        const currentOrders = await redis.get<Order[]>(`user:${userId}:orders`) || [];
        const newOrders = [order, ...currentOrders];

        const savePromises: Promise<unknown>[] = [
            redis.set(`user:${userId}:balance`, newBalance),
            redis.set(`user:${userId}:transactions`, newTransactions),
            redis.set(`user:${userId}:orders`, newOrders),
        ];

        // Store idempotency key for 24 hours
        if (idempotencyKey) {
            savePromises.push(redis.set(`idempotency:${userId}:${idempotencyKey}`, orderId, { ex: 86400 }));
        }

        await Promise.all(savePromises);

        return NextResponse.json({ 
            order,
            newBalance,
            transaction,
        });
    } catch (error) {
        console.error('[Orders API] Error creating order:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
