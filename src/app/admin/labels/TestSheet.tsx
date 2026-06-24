'use client';

import { useMemo } from 'react';
import { renderSymbolSVG } from '../../../lib/barcode';

export interface TestSheetItem {
    sku: string;
    /** Short code encoded in the barcode (falls back to sku). */
    scanCode?: string;
    productName?: string;
    variantName?: string;
    size?: string;
    color?: string;
}

/**
 * A 4×6 (101.6 × 152.4mm) print-only TEST SHEET of all barcodes — sized so a handheld
 * Code 128 scanner reads every one.
 *
 * The barcode encodes the SHORT scan code (e.g. HC-1042), not the long SKU. A short code
 * is ~52mm wide at a fat ~17-mil module — small, horizontal, dead-easy to scan — whereas
 * a 31-char SKU would be ~130mm and overflow the label. So each row is a standard
 * horizontal barcode with the short code big beneath it and the full SKU/name as text.
 * Several rows per 4×6 page, paginated across all items.
 */

const SHEET_W = 101.6;   // mm (4in)
const SHEET_H = 152.4;   // mm (6in)
const MARGIN = 5;        // mm printable margin
const ROW_H = 22;        // mm per row (barcode + text). ~6 per page.
const ROW_GAP = 2;       // mm between rows

const PER_PAGE = Math.floor((SHEET_H - 2 * MARGIN + ROW_GAP) / (ROW_H + ROW_GAP));

function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

/** Make the bwip-js SVG fill its container. */
function fill(svg: string): string {
    return svg
        .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
        .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
        .replace('<svg', '<svg preserveAspectRatio="none" width="100%" height="100%" style="display:block"');
}

function BarcodeRow({ item }: { item: TestSheetItem }) {
    const payload = item.scanCode || item.sku;
    const svg = useMemo(() => fill(renderSymbolSVG(payload, { scale: 4, heightMm: 12, includeText: false })), [payload]);
    const label = item.productName
        ? `${item.productName}${item.variantName ? ' · ' + item.variantName : ''}`
        : item.variantName;

    return (
        <div style={{
            height: `${ROW_H}mm`,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6mm',
            overflow: 'hidden',
            breakInside: 'avoid',
            borderBottom: '0.2mm solid #eef2f7',
            fontFamily: "'Phantom Sans', system-ui, sans-serif",
        }}>
            {/* Horizontal barcode, capped width so quiet zones survive */}
            <div style={{ width: '60%', height: '11mm' }} dangerouslySetInnerHTML={{ __html: svg }} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2mm', maxWidth: '96%' }}>
                <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '3mm', fontWeight: 700, letterSpacing: '0.06em' }}>{payload}</span>
                {item.scanCode && item.sku && item.sku !== item.scanCode && (
                    <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '2mm', fontWeight: 600, color: '#8492a6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sku}</span>
                )}
            </div>
            {label && <span style={{ fontSize: '2mm', fontWeight: 600, color: '#3c4858', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '96%' }}>{label}</span>}
        </div>
    );
}

export default function TestSheet({ items }: { items: TestSheetItem[] }) {
    const pages = chunk(items, PER_PAGE);
    return (
        <div className="hidden print:block">
            <style>{`
                @page { size: ${SHEET_W}mm ${SHEET_H}mm; margin: 0; }
                @media print {
                    html, body { background: #fff !important; }
                    .hc-testsheet-page {
                        width: ${SHEET_W}mm;
                        height: ${SHEET_H}mm;
                        box-sizing: border-box;
                        padding: ${MARGIN}mm;
                        display: flex;
                        flex-direction: column;
                        gap: ${ROW_GAP}mm;
                        page-break-after: always;
                        overflow: hidden;
                    }
                    .hc-testsheet-page:last-child { page-break-after: auto; }
                }
            `}</style>
            {pages.map((page, pi) => (
                <div key={pi} className="hc-testsheet-page">
                    {page.map((it, i) => <BarcodeRow key={`${pi}-${i}`} item={it} />)}
                </div>
            ))}
        </div>
    );
}

export { PER_PAGE as TEST_SHEET_PER_PAGE };
