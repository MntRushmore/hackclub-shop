import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../lib/authOptions';
import { Order, ShippingAddress } from '../../../types/Order';
import { isStructuredAddress, validateAddress } from '../../../lib/address';
import { rateLimit, rateLimitResponse } from '../../../lib/rateLimit';
import { PointsTransaction } from '../../../types/Points';
import { validateCSRFToken } from '../../../lib/csrf';
import { validateCartItems } from '../../../lib/productValidation';
import { isAdmin } from '../../../lib/adminAuth';
import { usdToPoints } from '../../../lib/paymentUtils';
import { validateQuotedRate, isShippingConfigured } from '../../../lib/shipping';
import { cartAddressFingerprint } from '../../../lib/checkoutUtils';
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
    // Points debited atomically up front; refunded if the order then fails to save.
    let debitedPoints = 0;
    try {
        const { items, pointsRequired, shippingCountry, shippingPointsCost, selectedRate, checkoutData, csrfToken, idempotencyKey } = await request.json() as {
            items: { id: string; name: string; price: string; quantity: number; variant_id?: string | number }[];
            pointsRequired: number;
            shippingPointsCost?: number;
            shippingCountry?: string;
            selectedRate?: { rateId: string; shipmentId: string; quoteId?: string };
            checkoutData?: Record<string, string | ShippingAddress>;
            csrfToken?: string;
            idempotencyKey?: string;
        };

        // Resolve the destination address up front: it's needed both to bind the
        // shipping quote (below) and to persist on the order (later).
        let shippingAddress: ShippingAddress | undefined;
        for (const value of Object.values(checkoutData || {})) {
            if (isStructuredAddress(value)) { shippingAddress = value as ShippingAddress; break; }
        }
        if (shippingAddress) {
            const addrErrors = validateAddress(shippingAddress);
            if (addrErrors.length > 0) {
                return NextResponse.json({ error: addrErrors[0] }, { status: 400 });
            }
        }

        // Points shipping = the live EasyPost rate, re-validated SERVER-SIDE and
        // converted to points at 1pt=$1. The chosen rate must come from a quote we
        // stamped for THIS exact cart + address (validateQuotedRate), so a client
        // can't reuse a cheap/light shipment's rate id on a heavier order. The
        // client's shippingPointsCost is NEVER trusted for the charge. When
        // EasyPost is configured, a shippable order REQUIRES a valid quoted rate —
        // it can't be omitted to get free shipping.
        let shippingPointsNum = 0;
        let validatedRate: { carrier: string; service: string; rate: number; estDeliveryDays?: number } | null = null;
        if (isShippingConfigured()) {
            if (!selectedRate?.rateId || !selectedRate.quoteId) {
                return NextResponse.json(
                    { error: 'Please select a shipping option before placing your order.' },
                    { status: 400 },
                );
            }
            const fingerprint = cartAddressFingerprint(items, shippingAddress);
            validatedRate = await validateQuotedRate(selectedRate.quoteId, selectedRate.rateId, fingerprint);
            if (!validatedRate) {
                return NextResponse.json(
                    { error: 'That shipping option is no longer available. Please re-select shipping.' },
                    { status: 400 },
                );
            }
            shippingPointsNum = usdToPoints(validatedRate.rate);
        }

        // Optional CSRF token: validated when present. (The app does not yet issue
        // CSRF tokens to clients, so this is belt-and-suspenders; the primary
        // protections are the same-site session cookie + the required idempotency
        // key below + the server-side balance/stock recomputation.)
        if (csrfToken) {
            const csrfValid = await validateCSRFToken(csrfToken);
            if (!csrfValid) {
                return NextResponse.json({ error: 'Invalid security token. Please refresh and try again.' }, { status: 403 });
            }
        }

        // Idempotency is REQUIRED — it is the guard against duplicate/replayed
        // orders racing the points + stock decrement. A client must not be able to
        // disable it by simply omitting the key.
        if (!idempotencyKey || typeof idempotencyKey !== 'string') {
            return NextResponse.json({ error: 'Missing idempotency key.' }, { status: 400 });
        }
        const existingOrder = await redis.get<string>(`idempotency:${userId}:${idempotencyKey}`);
        if (existingOrder) {
            return NextResponse.json({ error: 'Order already processed', orderId: existingOrder }, { status: 409 });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'No items in order' }, { status: 400 });
        }

        // pointsRequired must be a sane non-negative integer. It is cross-checked
        // against the server-recomputed total below, but reject NaN/Infinity/
        // fractional/negative up front so a crafted value can't reach the
        // comparison in an unexpected state.
        if (!Number.isInteger(pointsRequired) || pointsRequired < 0) {
            return NextResponse.json({ error: 'Invalid points total.' }, { status: 400 });
        }
        if (shippingPointsCost !== undefined && (!Number.isInteger(shippingPointsCost) || shippingPointsCost < 0)) {
            return NextResponse.json({ error: 'Invalid shipping points cost.' }, { status: 400 });
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

        // Admins (full-catalog mode) may pay points for ANY item — a cash-only
        // item is charged at 1 point = $1. Regular students may only buy
        // points-priced items.
        const buyerIsAdmin = await isAdmin(session);

        // Effective per-item points cost: the real points price, or (for admins)
        // the cash price at 1:1 when no points price exists.
        const itemPointsCost = (i: { pricePoints?: number; priceCash?: number }): number => {
            if (i.pricePoints && i.pricePoints > 0) return i.pricePoints;
            if (buyerIsAdmin && i.priceCash && i.priceCash > 0) return usdToPoints(i.priceCash);
            return 0;
        };

        if (!buyerIsAdmin) {
            // Every item a (non-admin) student buys must be points-priced.
            const nonPointsItem = validation.items!.find(i => !i.pricePoints || i.pricePoints <= 0);
            if (nonPointsItem) {
                return NextResponse.json({ error: `${nonPointsItem.name} can't be bought with points.` }, { status: 400 });
            }
        }

        const verifiedItemPointsTotal = validation.items!.reduce(
            (sum, i) => sum + itemPointsCost(i) * i.quantity,
            0,
        );

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

        // Atomically debit points: re-read the balance and decrement in a single
        // round trip so two concurrent orders from the same user can't both pass a
        // stale balance check and double-spend. The Lua script decrements only if
        // the balance covers the cost, returning the new balance, or -1 if it
        // doesn't (insufficient funds). Without this the get→set below would be a
        // classic check-then-set race exploitable with distinct idempotency keys.
        const DEBIT_LUA = `
            local bal = tonumber(redis.call('GET', KEYS[1]) or '0')
            local cost = tonumber(ARGV[1])
            if cost < 0 then return -1 end
            if bal < cost then return -1 end
            local nb = bal - cost
            redis.call('SET', KEYS[1], nb)
            return nb
        `;
        const balanceRedisKey = `user:${userId}:pointsBalance`;
        const debitResult = Number(
            await redis.eval(DEBIT_LUA, [balanceRedisKey], [String(verifiedPointsTotal)]),
        );

        if (debitResult < 0) {
            const currentBalance = (await redis.get<number>(balanceRedisKey)) ?? 0;
            return NextResponse.json({
                error: 'Insufficient points',
                required: verifiedPointsTotal,
                balance: currentBalance,
            }, { status: 400 });
        }
        // Points are now committed; refund this exact amount if anything below fails.
        debitedPoints = verifiedPointsTotal;
        const newPointsBalance = debitResult;

        // Decrement stock immediately — points orders settle in-request, so there's
        // no reservation window. If it fails (oversold) or anything below throws,
        // the catch/guard refunds the debited points and releases the units.
        const stockLines: StockLine[] = validation.items!.map(i => ({ variantId: i.variantId, quantity: i.quantity }));
        const stockResult = await commitImmediate(stockLines);
        if (!stockResult.ok) {
            // Refund the points we just debited — this order won't happen.
            await redis.incrby(`user:${userId}:pointsBalance`, debitedPoints);
            debitedPoints = 0;
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

        // shippingAddress was resolved + validated up front (needed for the quote).
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
            // Remember the chosen live rate so admin fulfillment can buy that exact
            // label (same as the HCB path). Not yet purchased.
            ...(validatedRate && selectedRate
                ? {
                      shipment: {
                          carrier: validatedRate.carrier,
                          service: validatedRate.service,
                          cost: validatedRate.rate,
                          easypostShipmentId: selectedRate.shipmentId,
                          chosenRateId: selectedRate.rateId,
                          chosenAtCheckout: true,
                      },
                  }
                : {}),
            checkoutData: checkoutData || {},
            status: 'pending',
            statusHistory: [
                { status: 'pending', timestamp: now }
            ],
            createdAt: now,
        };

        // Points were already debited atomically above (newPointsBalance =
        // debitResult). We only need to append the transaction + order records.
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

        // NOTE: do NOT re-set pointsBalance here — it was already debited
        // atomically by the Lua script. Re-setting it to a value captured before
        // a concurrent order ran would clobber that order's debit.
        const savePromises: Promise<unknown>[] = [
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
        // Order + transaction durably saved. The points are now legitimately
        // spent; clear the refund marker so the catch can't claw them back.
        debitedPoints = 0;

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
        // Roll back anything we committed for this failed attempt:
        //  - give back stock so units aren't stranded (best-effort/no-throw)
        //  - refund the atomically-debited points so the user isn't charged for
        //    an order that never saved.
        if (committedStock) void restock(committedStock);
        if (debitedPoints > 0) {
            void redis.incrby(`user:${userId}:pointsBalance`, debitedPoints);
        }
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
