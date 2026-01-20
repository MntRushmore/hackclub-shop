import { NextResponse } from 'next/server';

/**
 * HCB Webhook Handler
 *
 * This endpoint will receive webhooks from hcb.hackclub.com when a payment is made.
 *
 * TODO: Implement actual HCB API integration:
 * 1. Verify webhook signature from HCB
 * 2. Extract payment details (amount, user identifier)
 * 3. Add credits to user's account
 * 4. Store transaction record
 *
 * Expected webhook payload from HCB (placeholder):
 * {
 *   "event": "payment.completed",
 *   "data": {
 *     "id": "payment_xxx",
 *     "amount": 2500, // in cents
 *     "currency": "usd",
 *     "metadata": {
 *       "user_id": "user_xxx",
 *       "email": "user@example.com"
 *     }
 *   }
 * }
 */

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // todaaaaaaaa: Verify HCB webhook signature
        // const signature = request.headers.get('x-hcb-signature');
        // if (!verifySignature(signature, body)) {
        //     return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        // }

        const { event, data } = body;

        if (event === 'payment.completed') {
            const { amount, metadata } = data;
            const userId = metadata?.user_id || metadata?.email;

            if (!userId) {
                return NextResponse.json({
                    code: 400,
                    error: 'User identifier not found in payment metadata'
                }, { status: 400 });
            }

            const creditAmount = amount / 100;

            // todoaaa: Add credits to user account
            // In production, this would:
            // 1. Look up user by ID or email
            // 2. Add credits to their balance
            // 3. Create transaction record
            // 4. Send confirmation email

            console.log(`[HCB Webhook] Adding $${creditAmount} credits for user: ${userId}`);

            return NextResponse.json({
                code: 200,
                result: {
                    message: 'Credits added successfully',
                    amount: creditAmount,
                    userId,
                }
            });
        }

        return NextResponse.json({
            code: 200,
            result: {
                message: `Event ${event} received but not processed`
            }
        });

    } catch {
        console.error('[HCB Webhook] Error processing webhook');
        return NextResponse.json({
            code: 500,
            error: 'Internal server error'
        }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        code: 200,
        result: {
            status: 'healthy',
            message: 'HCB webhook endpoint is ready',
            integration: 'pending',
        }
    });
}
