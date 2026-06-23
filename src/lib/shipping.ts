/**
 * Shipping / postage layer for the shop — the "Pirate Ship" integration.
 *
 * Pirate Ship is a free front-end over the EasyPost carrier network: it has no
 * public REST API of its own, but the exact same labels and discounted rates are
 * available through EasyPost, which Pirate Ship is built on. So "integrate Pirate
 * Ship" here means: talk to EasyPost to fetch rates, buy postage labels, and get
 * tracking numbers. Staff who prefer the Pirate Ship web UI can still buy a label
 * there and paste the tracking number in — both paths land in `Order.shipment`.
 *
 * Provider-agnostic and safe by design, like `email.ts` and `airtableMirror.ts`:
 *   - No SDK; plain `fetch` against the EasyPost v2 REST API with Basic auth.
 *   - When EASYPOST_API_KEY is unset, every call returns a typed "not configured"
 *     result instead of throwing, so fulfillment still works with manual tracking.
 *
 * To go live: set EASYPOST_API_KEY (test key starts `EZTK`, prod `EZAK`) and the
 * SHIP_FROM_* env vars for the origin address postage ships from.
 */

import { ShippingAddress } from '../types/Order';

const API_BASE = 'https://api.easypost.com/v2';

export function isShippingConfigured(): boolean {
    return Boolean(process.env.EASYPOST_API_KEY);
}

/** Origin address postage ships from, read from env (the Hack Club warehouse). */
function fromAddress() {
    return {
        name: process.env.SHIP_FROM_NAME || 'Hack Club Shop',
        company: process.env.SHIP_FROM_COMPANY,
        street1: process.env.SHIP_FROM_STREET1,
        street2: process.env.SHIP_FROM_STREET2,
        city: process.env.SHIP_FROM_CITY,
        state: process.env.SHIP_FROM_STATE,
        zip: process.env.SHIP_FROM_ZIP,
        country: process.env.SHIP_FROM_COUNTRY || 'US',
        phone: process.env.SHIP_FROM_PHONE,
    };
}

function authHeader(): string {
    // EasyPost uses HTTP Basic auth: API key as the username, empty password.
    const key = process.env.EASYPOST_API_KEY || '';
    return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function easypost<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new Error(`EasyPost ${res.status} on ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
}

/** Map our ShippingAddress to EasyPost's address shape. */
function toEasyPostAddress(addr: ShippingAddress) {
    return {
        name: addr.name,
        street1: addr.line1,
        street2: addr.line2 || undefined,
        city: addr.city,
        state: addr.state,
        zip: addr.postal_code,
        country: addr.country,
    };
}

export interface ParcelSpec {
    /** ounces; EasyPost wants weight in oz. Defaults to a light flat-pack. */
    weightOz?: number;
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
}

export interface ShippingRate {
    id: string;          // EasyPost rate id, passed back to buyLabel
    carrier: string;
    service: string;
    rate: number;        // USD
    estDeliveryDays?: number;
    shipmentId: string;
}

export type RatesResult =
    | { ok: true; shipmentId: string; rates: ShippingRate[] }
    | { ok: false; reason: 'not_configured' | 'error'; message?: string };

export type BuyLabelResult =
    | {
          ok: true;
          carrier: string;
          service: string;
          trackingNumber: string;
          trackingUrl?: string;
          labelUrl?: string;
          shipmentId: string;
          cost?: number;
          estDeliveryDate?: string;
      }
    | { ok: false; reason: 'not_configured' | 'error'; message?: string };

interface EpRate {
    id: string;
    carrier: string;
    service: string;
    rate: string;
    delivery_days?: number | null;
}
interface EpShipment {
    id: string;
    rates: EpRate[];
    tracking_code?: string;
    selected_rate?: EpRate;
    postage_label?: { label_url?: string };
    tracker?: { public_url?: string; est_delivery_date?: string };
}

/**
 * Create an EasyPost shipment for an order's destination and return buyable
 * rates. Never throws — returns a typed failure so the admin UI can fall back to
 * manual tracking entry.
 */
export async function getRates(to: ShippingAddress, parcel: ParcelSpec = {}): Promise<RatesResult> {
    if (!isShippingConfigured()) return { ok: false, reason: 'not_configured' };
    try {
        const shipment = await easypost<EpShipment>('/shipments', {
            method: 'POST',
            body: JSON.stringify({
                shipment: {
                    to_address: toEasyPostAddress(to),
                    from_address: fromAddress(),
                    parcel: {
                        weight: parcel.weightOz ?? 6,
                        length: parcel.lengthIn,
                        width: parcel.widthIn,
                        height: parcel.heightIn,
                    },
                },
            }),
        });
        const rates: ShippingRate[] = (shipment.rates || [])
            .map(r => ({
                id: r.id,
                carrier: r.carrier,
                service: r.service,
                rate: parseFloat(r.rate),
                estDeliveryDays: r.delivery_days ?? undefined,
                shipmentId: shipment.id,
            }))
            .sort((a, b) => a.rate - b.rate);
        return { ok: true, shipmentId: shipment.id, rates };
    } catch (err) {
        console.error('[shipping] getRates failed:', err instanceof Error ? err.message : err);
        return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'rate lookup failed' };
    }
}

/**
 * Buy postage for a shipment+rate. Returns tracking + label details to persist on
 * the order. If `rateId` is omitted, buys the cheapest available rate.
 */
export async function buyLabel(shipmentId: string, rateId?: string): Promise<BuyLabelResult> {
    if (!isShippingConfigured()) return { ok: false, reason: 'not_configured' };
    try {
        let chosenRateId = rateId;
        if (!chosenRateId) {
            const current = await easypost<EpShipment>(`/shipments/${shipmentId}`, { method: 'GET' });
            const cheapest = (current.rates || []).slice().sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))[0];
            if (!cheapest) return { ok: false, reason: 'error', message: 'no rates available for shipment' };
            chosenRateId = cheapest.id;
        }
        const bought = await easypost<EpShipment>(`/shipments/${shipmentId}/buy`, {
            method: 'POST',
            body: JSON.stringify({ rate: { id: chosenRateId } }),
        });
        return {
            ok: true,
            carrier: bought.selected_rate?.carrier || '',
            service: bought.selected_rate?.service || '',
            trackingNumber: bought.tracking_code || '',
            trackingUrl: bought.tracker?.public_url,
            labelUrl: bought.postage_label?.label_url,
            shipmentId: bought.id,
            cost: bought.selected_rate ? parseFloat(bought.selected_rate.rate) : undefined,
            estDeliveryDate: bought.tracker?.est_delivery_date,
        };
    } catch (err) {
        console.error('[shipping] buyLabel failed:', err instanceof Error ? err.message : err);
        return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'label purchase failed' };
    }
}

/**
 * Refund unused postage (e.g. a label bought then cancelled). Best-effort; never
 * throws. EasyPost only refunds labels that were never scanned by the carrier.
 */
export async function refundLabel(shipmentId: string): Promise<boolean> {
    if (!isShippingConfigured()) return false;
    try {
        await easypost(`/shipments/${shipmentId}/refund`, { method: 'POST' });
        return true;
    } catch (err) {
        console.error('[shipping] refundLabel failed:', err instanceof Error ? err.message : err);
        return false;
    }
}

/**
 * Build a public tracking URL for a tracking number that was entered manually
 * (no EasyPost tracker). Falls back to a Google tracking search so the customer
 * always gets a clickable link.
 */
export function fallbackTrackingUrl(carrier: string | undefined, trackingNumber: string): string {
    const t = encodeURIComponent(trackingNumber);
    switch ((carrier || '').toLowerCase()) {
        case 'usps':
            return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
        case 'ups':
            return `https://www.ups.com/track?tracknum=${t}`;
        case 'fedex':
            return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
        case 'dhl':
        case 'dhlexpress':
            return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${t}`;
        default:
            return `https://www.google.com/search?q=${t}+tracking`;
    }
}
