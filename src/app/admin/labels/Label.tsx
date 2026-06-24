'use client';

import { useMemo } from 'react';
import { renderSymbolSVG } from '../../../lib/barcode';
import { BAG_MARK_DATA_URI, BAG_MARK_ASPECT, WORDMARK_DATA_URI, WORDMARK_ASPECT } from './wordmark';

/** A label-sheet template: physical label size + how many across/down per page. */
export interface LabelTemplate {
    id: string;
    name: string;
    widthMm: number;
    heightMm: number;
    cols: number;
    rows: number;
    /** Page margins (mm) so the grid lands on the die-cut. */
    pageMarginTopMm: number;
    pageMarginLeftMm: number;
    /** Gap between labels (mm). */
    gapXMm: number;
    gapYMm: number;
}

// Code 128 is a 1D barcode — it wants a wide, short label so the bars have room. These
// templates are all landscape-ish for that reason. Avery 5160 is the ubiquitous 30-up
// US address sheet; the others are common label-printer / hang-tag sizes.
export const LABEL_TEMPLATES: LabelTemplate[] = [
    {
        id: 'avery5160', name: 'Avery 5160 — 30-up (2⅝ × 1 in)',
        widthMm: 66.7, heightMm: 25.4, cols: 3, rows: 10,
        pageMarginTopMm: 12.7, pageMarginLeftMm: 4.7, gapXMm: 3.2, gapYMm: 0,
    },
    {
        id: 'avery5163', name: 'Avery 5163 — 10-up (4 × 2 in)',
        widthMm: 101.6, heightMm: 50.8, cols: 2, rows: 5,
        pageMarginTopMm: 12.7, pageMarginLeftMm: 4.7, gapXMm: 4.9, gapYMm: 0,
    },
    {
        id: 'tag', name: 'Product tag (2 × 1¼ in) — 16-up',
        widthMm: 50.8, heightMm: 31.75, cols: 3, rows: 5,
        pageMarginTopMm: 12.7, pageMarginLeftMm: 12.7, gapXMm: 6, gapYMm: 6,
    },
];

export interface LabelData {
    sku: string;
    /** The SHORT code encoded in the barcode (falls back to sku if absent). */
    scanCode?: string;
    productName?: string;
    variantName?: string;
    size?: string;
    color?: string;
}

export interface LabelStyle {
    showLogo: boolean;
    /** Which Hack Club Shop mark to show: the compact bag, or the full wordmark. */
    logo: 'bag' | 'wordmark';
    showProductName: boolean;
    showVariant: boolean;
    showSku: boolean;
    /** Brand accent for the hairline rule only — never tints the barcode. */
    accent: string;
}

/**
 * The Hack Club Shop brand mark, inlined as a data URI so print works offline (no
 * external fetch) and every label on a sheet reuses the same bytes. `bag` is the
 * compact square shopping-bag mark (default); `wordmark` is the full logo. Height-
 * driven; width follows the source aspect ratio.
 */
function ShopMark({ heightMm, variant }: { heightMm: number; variant: 'bag' | 'wordmark' }) {
    const isBag = variant === 'bag';
    const src = isBag ? BAG_MARK_DATA_URI : WORDMARK_DATA_URI;
    const aspect = isBag ? BAG_MARK_ASPECT : WORDMARK_ASPECT;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt="Hack Club Shop"
            style={{ height: `${heightMm}mm`, width: `${heightMm * aspect}mm`, display: 'block', objectFit: 'contain' }}
        />
    );
}

/**
 * One printable Code 128 label. Header (brand + product/variant) on top, the barcode
 * spanning the full width below, SKU text under it. The barcode is rendered to an SVG
 * string by bwip-js and injected; everything else is normal markup so it scales and
 * prints crisply. Pure black-on-white bars with a quiet zone for scan reliability; the
 * accent appears only on the hairline rule.
 */
export default function Label({
    data,
    style,
    widthMm,
    heightMm,
}: {
    data: LabelData;
    style: LabelStyle;
    widthMm: number;
    heightMm: number;
}) {
    // The barcode encodes the SHORT scan code (compact → fits + scans). The full SKU
    // prints as text. Fall back to the SKU if no scan code has been minted yet.
    const payload = data.scanCode || data.sku;
    const barcodeSvg = useMemo(
        () => renderSymbolSVG(payload, { scale: 3, heightMm: 12, includeText: false }),
        [payload],
    );

    const variantLine = data.variantName
        || [data.size, data.color].filter(Boolean).join(' · ')
        || undefined;

    // Reserve roughly half the label height for the barcode, the rest for the header.
    const barcodeHeightMm = Math.max(7, heightMm * 0.42);

    return (
        <div
            className="hc-label"
            style={{
                width: `${widthMm}mm`,
                height: `${heightMm}mm`,
                boxSizing: 'border-box',
                padding: '1.6mm',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.8mm',
                background: '#fff',
                overflow: 'hidden',
                fontFamily: "'Phantom Sans', system-ui, sans-serif",
                color: '#17171d',
            }}
        >
            {/* Header: brand + product/variant */}
            <div style={{ flex: '0 0 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3mm' }}>
                {style.showLogo && (
                    style.logo === 'wordmark' ? (
                        <ShopMark variant="wordmark" heightMm={Math.min(4, heightMm * 0.16)} />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1mm' }}>
                            <ShopMark variant="bag" heightMm={3.6} />
                            <span style={{ fontSize: '2mm', fontWeight: 900, letterSpacing: '0.02em' }}>Hack&nbsp;Club&nbsp;Shop</span>
                        </div>
                    )
                )}
                {style.showProductName && data.productName && (
                    <div style={{ fontSize: '2.4mm', fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {data.productName}
                    </div>
                )}
                {style.showVariant && variantLine && (
                    <div style={{ fontSize: '2mm', fontWeight: 600, color: '#3c4858', lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {variantLine}
                    </div>
                )}
            </div>

            {/* Barcode + SKU text */}
            <div style={{ flex: '0 0 auto', borderTop: `0.4mm solid ${style.accent}`, paddingTop: '0.8mm' }}>
                <div
                    style={{ width: '100%', height: `${barcodeHeightMm}mm` }}
                    // bwip-js returns trusted SVG we generated from a sanitized SKU.
                    dangerouslySetInnerHTML={{ __html: sizeSvg(barcodeSvg) }}
                />
                {style.showSku && (
                    <div style={{ textAlign: 'center', marginTop: '0.3mm', lineHeight: 1.1 }}>
                        {/* Big: the short scan code (what the barcode is). Small: full SKU. */}
                        <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '2.8mm', fontWeight: 700, letterSpacing: '0.08em' }}>
                            {payload || '—'}
                        </div>
                        {data.scanCode && data.sku && data.sku !== data.scanCode && (
                            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '1.7mm', fontWeight: 600, color: '#8492a6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {data.sku}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Force the bwip-js SVG to fill its container (it ships with fixed px dims). */
function sizeSvg(svg: string): string {
    return svg
        .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
        .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
        .replace('<svg', '<svg preserveAspectRatio="none" width="100%" height="100%" style="display:block"');
}
