'use client';

import { useEffect, useRef } from 'react';

/**
 * Google Places autocomplete for the checkout address block. Binds to the
 * street-address input (by its `name`) and, when the shopper picks a
 * suggestion, hands the parsed address parts back so the page can fill every
 * field at once.
 *
 * Config-gated: renders nothing unless NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set
 * (Google Cloud Console → APIs & Services → enable "Places API" + "Maps
 * JavaScript API", create a browser key restricted to the shop's domains).
 * Autocomplete is a typing aid, not enforcement — the server independently
 * verifies deliverability with EasyPost before quoting shipping, so a missing
 * key only costs convenience.
 */

export interface AutocompletedAddress {
    line1: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
}

declare global {
    interface Window {
        google?: any;
        __hcMapsLoaded?: Promise<void>;
    }
}

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

function loadMapsScript(): Promise<void> {
    if (window.google?.maps?.places) return Promise.resolve();
    if (window.__hcMapsLoaded) return window.__hcMapsLoaded;
    window.__hcMapsLoaded = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY!)}&libraries=places&loading=async`;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Google Maps failed to load'));
        document.head.appendChild(s);
    });
    return window.__hcMapsLoaded;
}

export default function AddressAutocomplete({
    inputName,
    onSelect,
}: {
    /** `name` attribute of the street-address input to attach to. */
    inputName: string;
    onSelect: (address: AutocompletedAddress) => void;
}) {
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    useEffect(() => {
        if (!KEY) return;
        let autocomplete: any;
        let cancelled = false;

        loadMapsScript()
            .then(() => {
                if (cancelled) return;
                const input = document.querySelector<HTMLInputElement>(`input[name="${inputName}"]`);
                if (!input || input.dataset.hcAutocomplete === '1') return;
                input.dataset.hcAutocomplete = '1';

                autocomplete = new window.google.maps.places.Autocomplete(input, {
                    types: ['address'],
                    componentRestrictions: { country: 'us' },
                    fields: ['address_components'],
                });
                autocomplete.addListener('place_changed', () => {
                    const components: Array<{ types: string[]; long_name: string; short_name: string }> =
                        autocomplete.getPlace()?.address_components || [];
                    const get = (type: string, short = false) => {
                        const c = components.find((x) => x.types.includes(type));
                        return c ? (short ? c.short_name : c.long_name) : '';
                    };
                    const streetNumber = get('street_number');
                    const route = get('route');
                    const line1 = [streetNumber, route].filter(Boolean).join(' ');
                    if (!line1) return; // e.g. a city-level pick; leave the field alone
                    onSelectRef.current({
                        line1,
                        city: get('locality') || get('sublocality') || get('postal_town'),
                        state: get('administrative_area_level_1', true),
                        postal_code: get('postal_code'),
                        country: get('country', true) || 'US',
                    });
                });
            })
            .catch(() => {
                // Script blocked or misconfigured key: silently degrade to plain
                // typing; the server-side deliverability check still guards.
            });

        return () => {
            cancelled = true;
            if (autocomplete && window.google?.maps?.event) {
                window.google.maps.event.clearInstanceListeners(autocomplete);
            }
        };
    }, [inputName]);

    return null;
}
