/**
 * Barcode rendering for labels — a thin, typed wrapper over bwip-js's browser
 * `toSVG`. SVG (not canvas) so labels stay vector-crisp at any print DPI.
 *
 * We use Code 128 exclusively: it's the ubiquitous 1D symbology every handheld USB
 * laser scanner reads instantly (the HQ scanner included), and it's compact for the
 * short alphanumeric SKUs we encode. The encoded value is always the variant's SKU —
 * never price/cost/PII (see src/lib/sku.ts).
 *
 * Client-only: import the browser build. The quiet zone is mandatory for scan
 * reliability, so we never trim it; bars are pure black on white (brand color lives
 * on the surrounding label chrome, never on the code itself).
 */

// bwip-js "browser" subpath (the bundler resolves it via the package's exports map);
// types come from src/types/bwip-js-browser.d.ts.
import { toSVG } from 'bwip-js/browser';

export interface RenderOpts {
    /** Module/bar scale factor. Higher = larger symbol. Default 3. */
    scale?: number;
    /** Bar height in mm. Default 12. */
    heightMm?: number;
    /** Render the human-readable text under the barcode. Default false (we print our own). */
    includeText?: boolean;
}

/**
 * Render `value` as a Code 128 SVG string. Returns a one-line error `<svg>` instead of
 * throwing, so a bad/empty playground payload can't crash the designer's live preview.
 */
export function renderSymbolSVG(value: string, opts: RenderOpts = {}): string {
    const text = (value ?? '').toString();
    if (!text) return placeholderSVG('enter a value');

    try {
        return toSVG({
            bcid: 'code128',
            text,
            scale: opts.scale ?? 3,
            height: opts.heightMm ?? 12,        // mm
            includetext: opts.includeText ?? false,
            textxalign: 'center',
            paddingwidth: 0,
            paddingheight: 0,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'render failed';
        return placeholderSVG(msg.length > 40 ? msg.slice(0, 40) + '…' : msg);
    }
}

function placeholderSVG(message: string): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" role="img" aria-label="${escapeXml(message)}">` +
        `<rect width="200" height="60" fill="#fff" stroke="#e2e8f0" stroke-dasharray="4 4"/>` +
        `<text x="100" y="34" text-anchor="middle" font-family="monospace" font-size="11" fill="#94a3b8">${escapeXml(message)}</text>` +
        `</svg>`
    );
}

function escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, c => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}
