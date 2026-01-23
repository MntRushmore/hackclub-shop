import { Coupon } from '../types/Admin';
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface CouponValidationResult {
    valid: boolean;
    error?: string;
    coupon?: Coupon;
    discount?: number;
}

export async function validateAndApplyCoupon(
    code: string,
    cartTotal: number
): Promise<CouponValidationResult> {
    try {
        const coupon = await redis.get<Coupon>(`coupon:${code.toUpperCase().trim()}`);

        if (!coupon) {
            return { valid: false, error: 'Coupon code not found' };
        }

        if (!coupon.active) {
            return { valid: false, error: 'Coupon is no longer active' };
        }

        if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
            return { valid: false, error: 'Coupon has expired' };
        }

        if (coupon.usageType === 'single') {
            if (coupon.usageCount >= 1) {
                return { valid: false, error: 'Coupon has already been used' };
            }
        } else if (coupon.usageType === 'limited') {
            if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
                return { valid: false, error: `Coupon usage limit reached (${coupon.usageLimit} uses)` };
            }
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (cartTotal * coupon.discountValue) / 100;
        } else if (coupon.discountType === 'fixed') {
            discount = Math.min(coupon.discountValue, cartTotal);
        }

        return {
            valid: true,
            coupon,
            discount: parseFloat(discount.toFixed(2)),
        };
    } catch (error) {
        console.error('Coupon validation error:', error);
        return { valid: false, error: 'Failed to validate coupon' };
    }
}

export async function incrementCouponUsage(couponId: string, code: string): Promise<void> {
    try {
        const coupon = await redis.get<Coupon>(`coupon:${couponId}`);
        if (coupon) {
            coupon.usageCount = (coupon.usageCount || 0) + 1;
            await redis.set(`coupon:${couponId}`, coupon);
            await redis.set(`coupon:${code}`, coupon);
        }
    } catch (error) {
        console.error('Failed to increment coupon usage:', error);
    }
}
