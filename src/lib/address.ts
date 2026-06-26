import { ShippingAddress } from '../types/Order';

/**
 * Country list for the shipping country dropdown (ISO 3166-1 alpha-2).
 *
 * USA-only shop: this single list drives BOTH the checkout country dropdown and
 * the Stripe Checkout `allowed_countries` (see api/checkout/stripe/route.ts), so
 * keeping it to just US enforces US-only everywhere. To re-open international
 * shipping later, add countries back here.
 */
export const COUNTRIES: { code: string; name: string }[] = [
    { code: 'US', name: 'United States' },
];

export const EMPTY_ADDRESS: ShippingAddress = {
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal_code: '',
    // USA-only shop: default to US so the customer never has to pick a country
    // (and browser autofill, which often fails to fire a change event on the
    // country <select>, can't leave it blank and silently block rate lookup).
    country: 'US',
};

/** True when an object looks like a structured ShippingAddress. */
export function isStructuredAddress(value: unknown): value is ShippingAddress {
    return (
        typeof value === 'object' &&
        value !== null &&
        'line1' in (value as Record<string, unknown>) &&
        'city' in (value as Record<string, unknown>)
    );
}

/**
 * Validate a structured address. Returns a list of human-readable errors
 * (empty list = valid). Line 2 is optional; everything else is required.
 */
export function validateAddress(addr: Partial<ShippingAddress> | undefined): string[] {
    const errors: string[] = [];
    if (!addr) return ['Shipping address is required'];

    if (!addr.name?.trim()) errors.push('Recipient name is required');
    if (!addr.line1?.trim()) errors.push('Address line 1 is required');
    if (!addr.city?.trim()) errors.push('City is required');
    if (!addr.state?.trim()) errors.push('State / province is required');
    if (!addr.postal_code?.trim()) errors.push('Postal code is required');
    if (!addr.country?.trim()) errors.push('Country is required');

    return errors;
}

/** Format a structured address into a single human-readable line. */
export function formatAddress(addr: ShippingAddress | undefined | null): string {
    if (!addr) return '';
    const countryName = COUNTRIES.find((c) => c.code === addr.country)?.name || addr.country;
    return [
        addr.name,
        addr.line1,
        addr.line2,
        [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
        countryName,
    ]
        .filter(Boolean)
        .join('\n');
}
