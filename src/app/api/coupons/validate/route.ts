import { NextResponse } from 'next/server';
import { validateAndApplyCoupon } from '../../../../lib/couponValidation';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

// NOTE: coupon discounts are currently DISPLAY-ONLY — neither checkout route
// (points or HCB) subtracts a coupon discount from the server-computed charge.
// If a discount is ever wired into a real charge, the redemption step MUST call
// incrementCouponUsage() atomically (see lib/couponValidation.ts) so single/
// limited-use coupons can't be replayed; today that counter is never advanced.

export async function POST(request: Request) {
    // Unauthenticated endpoint — rate-limit by IP to stop coupon-code
    // enumeration / brute-force.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`coupon:validate:${ip}`, { maxRequests: 15, windowMs: 60000 });
    if (!rl.success) return rateLimitResponse();

    try {
        const body = await request.json();
        const { code, cartTotal } = body;

        if (!code || typeof code !== 'string' || typeof cartTotal !== 'number' || !Number.isFinite(cartTotal) || cartTotal < 0) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const result = await validateAndApplyCoupon(code, cartTotal);

        if (!result.valid) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
            valid: true,
            couponCode: result.coupon?.code,
            discount: result.discount,
            finalTotal: cartTotal - (result.discount || 0),
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to validate coupon' }, { status: 500 });
    }
}
