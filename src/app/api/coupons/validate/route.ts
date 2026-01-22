import { NextResponse } from 'next/server';
import { validateAndApplyCoupon } from '../../../../lib/couponValidation';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { code, cartTotal } = body;

        if (!code || typeof cartTotal !== 'number') {
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
