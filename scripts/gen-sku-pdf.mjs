// Print-ready PDF of SKU barcodes for the Zebra ZD621 (4x6 thermal labels).
//
// KEY DESIGN: the barcode encodes a SHORT scan code (e.g. "HC-1042"), NOT the long
// human-readable SKU. A 31-char SKU is ~396 modules → ~131mm wide, which overflows a
// 4in label and is hard to scan; a short code is ~40mm at a fat 15-mil module width and
// scans instantly. The full SKU + product name print as TEXT beneath the barcode.
//
// One label per 4x6 page: a standard horizontal Code 128, centered, bold bars.
import bwip from 'bwip-js/browser';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

// [shortCode, fullSku, label]. shortCode is what the barcode encodes + the scanner emits.
const ITEMS = [
    ['HC-1001', 'HC-DRNKWR-CMPFRMG-ONSZWHT', 'Camp Fire Mug · One Size · White'],
    ['HC-1002', 'HC-STICKERS-HCKCLBSTCK-ONSZDFLT', 'Hack Club Sticker Pack · One Size'],
    ['HC-1003', 'HC-APPAREL-HCKCLBTSHR-SBLACK', 'Hack Club T-Shirt · S · Black'],
    ['HC-1004', 'HC-APPAREL-HCKCLBTSHR-MBLACK', 'Hack Club T-Shirt · M · Black'],
    ['HC-1005', 'HC-APPAREL-HCKCLBTSHR-LBLACK', 'Hack Club T-Shirt · L · Black'],
];

const MM = 72 / 25.4;
const PAGE_W = 101.6 * MM;     // 4in
const PAGE_H = 152.4 * MM;     // 6in
const SAFE = 5 * MM;           // thermal non-printable edge guard
const SAFE_W = PAGE_W - 2 * SAFE;
const QUIET = 10;              // quiet-zone modules each side
const X_MM = 0.43;             // module width — fat 17mil, very forgiving for handhelds
const BAR_H = 22 * MM;         // bar height

function fitSize(font, text, max, min = 6) {
    let s = max;
    while (s > min && font.widthOfTextAtSize(text, s) > SAFE_W) s -= 0.5;
    return s;
}

async function build() {
    const doc = await PDFDocument.create();
    const monoB = await doc.embedFont(StandardFonts.CourierBold);
    const mono = await doc.embedFont(StandardFonts.Courier);
    const sans = await doc.embedFont(StandardFonts.Helvetica);

    for (const [code, sku, label] of ITEMS) {
        const sbs = bwip.raw('code128', code)[0].sbs;
        const totalModules = sbs.reduce((a, b) => a + b, 0) + 2 * QUIET;

        const page = doc.addPage([PAGE_W, PAGE_H]);

        // Horizontal barcode, centered. Module width capped so it never exceeds SAFE_W.
        const modulePt = Math.min(X_MM * MM, SAFE_W / totalModules);
        const barTotalW = totalModules * modulePt;
        const xStart = (PAGE_W - barTotalW) / 2 + QUIET * modulePt;   // left edge of first bar (after quiet)
        const barTop = PAGE_H / 2 + BAR_H / 2;                        // vertically centered
        const barBot = PAGE_H / 2 - BAR_H / 2;

        let x = xStart;
        for (let i = 0; i < sbs.length; i++) {
            const w = sbs[i] * modulePt;
            if (i % 2 === 0) page.drawRectangle({ x, y: barBot, width: w, height: BAR_H, color: rgb(0, 0, 0) });
            x += w;
        }

        // BIG short code right under the barcode (this is what a human types as fallback).
        const codeSize = 22;
        page.drawText(code, { x: (PAGE_W - monoB.widthOfTextAtSize(code, codeSize)) / 2, y: barBot - 30, size: codeSize, font: monoB, color: rgb(0, 0, 0) });

        // Full SKU (smaller, mono) + product label, near the bottom, auto-shrunk to fit.
        const skuSize = fitSize(mono, sku, 11, 6);
        page.drawText(sku, { x: (PAGE_W - mono.widthOfTextAtSize(sku, skuSize)) / 2, y: SAFE + 18, size: skuSize, font: mono, color: rgb(0.1, 0.1, 0.12) });
        if (label) {
            let t = label; const s = 9;
            while (sans.widthOfTextAtSize(t + '…', s) > SAFE_W && t.length > 4) t = t.slice(0, -2);
            if (t !== label) t += '…';
            page.drawText(t, { x: (PAGE_W - sans.widthOfTextAtSize(t, s)) / 2, y: SAFE + 4, size: s, font: sans, color: rgb(0.23, 0.28, 0.35) });
        }

        // Brand caption top-center.
        const cap = 'Hack Club Shop';
        page.drawText(cap, { x: (PAGE_W - sans.widthOfTextAtSize(cap, 9)) / 2, y: PAGE_H - SAFE - 12, size: 9, font: sans, color: rgb(0.45, 0.5, 0.56) });
    }
    return doc.save();
}

const out = process.argv[2] || 'hackclub-shop-skus-4x6.pdf';
const bytes = await build();
writeFileSync(out, bytes);

const longest = ITEMS.map(i => i[0]).sort((a, b) => b.length - a.length)[0];
const mods = bwip.raw('code128', longest)[0].sbs.reduce((a, b) => a + b, 0) + 2 * QUIET;
const xMm = Math.min(X_MM, (SAFE_W / MM) / mods);
console.log(`wrote ${out} (${bytes.length} bytes, ${ITEMS.length} labels)`);
console.log(`barcode encodes SHORT code; X ≈ ${xMm.toFixed(3)}mm (${(xMm / 0.0254).toFixed(1)} mil), width ≈ ${(mods * xMm).toFixed(0)}mm on a ${(PAGE_W / MM).toFixed(0)}mm label`);
