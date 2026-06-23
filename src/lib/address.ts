import { ShippingAddress } from '../types/Order';

/**
 * Common country list for the shipping country dropdown.
 * ISO 3166-1 alpha-2 codes. Ordered with frequent destinations first.
 */
export const COUNTRIES: { code: string; name: string }[] = [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'AU', name: 'Australia' },
    { code: 'IN', name: 'India' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'IE', name: 'Ireland' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'SG', name: 'Singapore' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'ES', name: 'Spain' },
    { code: 'IT', name: 'Italy' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'JP', name: 'Japan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'OTHER', name: 'Other' },
];

export const EMPTY_ADDRESS: ShippingAddress = {
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal_code: '',
    // No default — the customer must actively pick a country so an international
    // order isn't silently treated as US (wrong rates / mis-addressed label).
    country: '',
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
