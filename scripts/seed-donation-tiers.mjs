// Seed the six donation-tier products into Stripe (the catalog's source of
// truth) — see DONATION_PIVOT_PROMPT.md. Idempotent: products match on
// metadata.shop_product_id, so re-running updates in place; Stripe Prices are
// immutable, so a changed donation amount archives the old Price and creates a
// new one (same variant_id metadata, so orders/inventory joins keep working).
//
// The donation amount IS the variant's cash price. The gift's fair market value
// + tier name live in the product's `config` metadata blob (`donation`), which
// checkout uses to split the charge into a taxable gift line and a nontaxable
// donation line, and the receipt email uses for the IRS acknowledgment.
//
// Usage:
//   node scripts/seed-donation-tiers.mjs --dry-run   # print the plan, touch nothing
//   node scripts/seed-donation-tiers.mjs             # create/update in Stripe
//
// Requires STRIPE_SECRET_KEY (read from the environment or .env.local).
// After seeding: set per-variant stock (Price metadata `stock`) before launch —
// unset stock means UNTRACKED = unlimited, and vest stock is limited.

import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

// Minimal .env.local loader so the script runs outside `next dev`.
if (!process.env.STRIPE_SECRET_KEY) {
    try {
        for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env.local — rely on the environment */ }
}

const DRY_RUN = process.argv.includes('--dry-run');
const MANAGED_BY = 'hackclub_shop'; // CATALOG_MANAGED_FLAG in src/lib/catalogMapping.ts

const APPAREL_SIZES = ['S', 'M', 'L', 'XL', '2XL'];
const ADDRESS_FIELD = { id: 'shipping_address', name: 'shipping_address', label: 'Shipping address', type: 'address', required: true };

// One entry per tier. Variants = the donor's gift choice (and size). unitCost is
// the full fulfillment COGS for the tier (gift + any included extras), so
// finance reporting stays honest. fmvCents is the tier-level fair market value
// disclosure — set to the highest-value gift option where there's a choice.
//
// Images live in public/gifts/ (see product-photos/README.md for the intake
// flow). `image` on a tier is the /shop card + product-page hero; `image` on a
// variant follows that gift into pickers, carts, and receipts. All paths are
// site-relative: next/image serves them, and Stripe-hosted pages (which need
// absolute URLs) simply skip them.
const GIFT_IMG = {
    stickers: '/gifts/sticker.jpg',
    mug: '/gifts/mug.jpg',
    tote: '/gifts/tote.jpg',
    tee: '/gifts/tee.jpg',
    college: '/gifts/hoodie.jpg',
    mom: '/gifts/mom-sweatshirt.jpg',
    vest: '/gifts/vest.jpg',
};

// Gift pieces, shared across tiers: a tier's picker offers its own marquee
// piece(s) PLUS everything from the tiers below it, so giving more never
// means fewer choices. Keys repeat across tiers safely (variant ids are
// namespaced per product). Order matters: marquee first (it drives the
// stamped sort index and the default pick).
// Stripe Tax: clothing (tees/sweatshirts/vests/caps) carries the clothing code
// — tax-exempt in Vermont, where the shop is registered — while general goods
// (stickers, mugs, totes) stay on the tangible-goods default at checkout.
const CLOTHING_TAX_CODE = 'txcd_30011000';

// Per-gift declared fair market value (integer cents, Price metadata
// `fmv_cents`). Checkout bills each chosen gift as its own FMV line — own
// value, own tax code — so a Founders Circle vest+mug pick discloses
// $100 + $30, not the tier-level $180 pair maximum. Derived from the
// tier-level fmvCents declarations below (each tier's FMV = its
// highest-value gift): stickers $5, mug/tote $30, tee/cap $35,
// sweatshirts $80, vest $100.
const STICKERS = { key: 'stickers', name: 'Bumper Sticker', unitCost: 1.9, image: GIFT_IMG.stickers, fmvCents: 500 };
const MUG = { key: 'mug', name: 'Mug', unitCost: 7.12, image: GIFT_IMG.mug, fmvCents: 3000 };
const TOTE = { key: 'tote', name: 'Tote Bag', unitCost: 14.4, image: GIFT_IMG.tote, fmvCents: 3000 };
const CAP = { key: 'cap', name: 'Cap', unitCost: 15.94, taxCode: CLOTHING_TAX_CODE, fmvCents: 3500 };
const TEES = APPAREL_SIZES.map(size => ({ key: `tee-${size.toLowerCase()}`, name: `T-Shirt · ${size}`, size, unitCost: 18.2, image: GIFT_IMG.tee, taxCode: CLOTHING_TAX_CODE, fmvCents: 3500 }));
const COLLEGES = APPAREL_SIZES.map(size => ({ key: `college-${size.toLowerCase()}`, name: `College Sweatshirt · ${size}`, size, unitCost: 36.4, image: GIFT_IMG.college, taxCode: CLOTHING_TAX_CODE, fmvCents: 8000 }));
const MOMS = APPAREL_SIZES.map(size => ({ key: `mom-${size.toLowerCase()}`, name: `Mom Sweatshirt · ${size}`, size, unitCost: 39.28, image: GIFT_IMG.mom, taxCode: CLOTHING_TAX_CODE, fmvCents: 8000 }));
const VESTS = (keyPrefix) => APPAREL_SIZES.map(size => ({ key: `${keyPrefix}-${size.toLowerCase()}`, name: `Vest · ${size}`, size, unitCost: 55.6, image: GIFT_IMG.vest, taxCode: CLOTHING_TAX_CODE, fmvCents: 10000 }));
const TIERS = [
    {
        id: 'donation-tier-supporter',
        name: 'Supporter',
        tier: 'Supporter',
        amount: 25,
        fmvCents: 500,
        description: "$25 can cover a year of domains, hosting, and dev tools for one teenager. It's what keeps their projects online. We'll mail you a bumper sticker as a thank you.",
        image: GIFT_IMG.stickers,
        variants: [STICKERS],
    },
    {
        id: 'donation-tier-friend',
        name: 'Friend',
        tier: 'Friend',
        amount: 100,
        fmvCents: 3000,
        description: 'Plenty of kids never make it to their first hackathon because they can\'t afford the bus or train to get there. $100 can go toward travel that puts one of them in the room. You can pick the mug, the tote bag, or the bumper sticker as your thank you.',
        image: GIFT_IMG.mug,
        variants: [MUG, TOTE, STICKERS],
    },
    {
        id: 'donation-tier-champion',
        name: 'Champion',
        tier: 'Champion',
        amount: 150,
        fmvCents: 3500,
        description: 'Somewhere a teenager is one small grant away from their first circuit board. $150 can fund a hardware grant, which for most teenagers means parts for something they\'ve been wanting to build for months. Your thank you gift is the tee or the cap, or any of the smaller gifts.',
        image: '/gifts/tee-event.jpg',
        variants: [...TEES, CAP, MUG, TOTE, STICKERS],
    },
    {
        id: 'donation-tier-patron',
        name: 'Patron',
        tier: 'Patron',
        amount: 250,
        fmvCents: 8000,
        description: 'Summer is when teenagers have time to build something real, if they can afford to spend it that way. $250 can back one kid through a summer of building. Pick the College sweatshirt or any of the smaller gifts as your thank you.',
        image: GIFT_IMG.college,
        variants: [...COLLEGES, ...TEES, CAP, MUG, TOTE, STICKERS],
    },
    {
        id: 'donation-tier-philanthropist',
        name: 'Philanthropist',
        tier: 'Philanthropist',
        amount: 500,
        fmvCents: 10000,
        description: "A lot of talented kids are coding on school Chromebooks or borrowed phones. $500 can buy one of them a real laptop. Your thank you gift is the Hack Club vest, or you can pick any of the smaller gifts instead.",
        image: GIFT_IMG.vest,
        variants: [...VESTS('vest'), ...COLLEGES, ...MOMS, ...TEES, CAP, MUG, TOTE, STICKERS],
    },
    {
        id: 'donation-tier-founders-circle',
        name: 'Parents Founders Circle',
        tier: 'Parents Founders Circle',
        amount: 1000,
        plus: true, // renders as "$1,000+" — top up to any total at checkout
        giftPicks: 2, // donor chooses two pieces; the second pick arrives at checkout
        fmvCents: 18000, // highest pick pair: vest ($100) + sweatshirt ($80)
        description: "$1,000 can put a laptop in a kid's hands and still help with hackathon travel and a hardware grant. You can add more at checkout if you'd like. As a thank you, pick any two pieces of our merch, including the Hack Club vest.",
        image: '/gifts/hoodie-event.jpg',
        // Single pieces, not kits: the cart line's variant is the donor's first
        // pick and checkout collects the second (unitCost here is the piece's
        // own cost; checkout adds the second pick's cost onto the order line).
        // Vest keys stay `kit-vest-*` so the existing per-size stock caps on
        // those Stripe Prices, and old orders' variant joins, carry over.
        variants: [...VESTS('kit-vest'), ...COLLEGES, ...MOMS, ...TEES, CAP, MUG, TOTE, STICKERS],
    },
];

function productPayload(t) {
    const config = {
        category: 'donation',
        checkoutFields: [ADDRESS_FIELD],
        donation: { tier: t.tier, fmvCents: t.fmvCents, ...(t.plus ? { plus: true } : {}), ...(t.giftPicks ? { giftPicks: t.giftPicks } : {}) },
        ...(t.image ? { image_url: t.image, thumbnail_url: t.image } : {}),
    };
    const json = JSON.stringify(config);
    if (json.length > 500) throw new Error(`${t.id}: config metadata is ${json.length} chars (Stripe caps values at 500)`);
    return {
        name: t.name,
        description: t.description,
        // Donation tiers bill via split price_data lines with their own tax codes,
        // but keep the goods code on the Product for safety if anything ever bills
        // by Price id directly.
        tax_code: 'txcd_99999999',
        metadata: { managed_by: MANAGED_BY, shop_product_id: t.id, config: json },
    };
}

function priceMetadata(t, v, index) {
    return {
        managed_by: MANAGED_BY,
        variant_id: `${t.id}-${v.key}`,
        name: v.name,
        unit_cost: String(v.unitCost),
        is_cash_buyable: '1',
        // Display position in gift pickers — Stripe list order isn't stable
        // (newest-first, second-resolution ties), so order is explicit.
        sort: String(index),
        ...(v.size ? { size: v.size } : {}),
        ...(v.image ? { image_url: v.image } : {}),
        ...(v.taxCode ? { tax_code: v.taxCode } : {}),
        ...(v.fmvCents ? { fmv_cents: String(v.fmvCents) } : {}),
    };
}

async function main() {
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY is not set (env or .env.local)');
        process.exit(1);
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    for (const tier of TIERS) {
        const payload = productPayload(tier);
        const found = await stripe.products.search({
            query: `metadata['shop_product_id']:'${tier.id}' AND metadata['managed_by']:'${MANAGED_BY}'`,
            limit: 1,
        });

        if (DRY_RUN) {
            console.log(`[dry-run] ${found.data[0] ? 'update' : 'create'} ${tier.id} — ${tier.name}, $${tier.amount}, FMV $${tier.fmvCents / 100}, ${tier.variants.length} variant(s)`);
            continue;
        }

        const product = found.data[0]
            ? await stripe.products.update(found.data[0].id, { ...payload, active: true })
            : await stripe.products.create(payload);

        // Upsert one Price per variant (matched by variant_id metadata). A changed
        // amount archives + recreates, since Stripe Prices are immutable.
        const existing = new Map();
        for await (const price of stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
            if (price.metadata?.variant_id) existing.set(price.metadata.variant_id, price);
        }
        const kept = new Set();
        for (const [index, v] of tier.variants.entries()) {
            const meta = priceMetadata(tier, v, index);
            const unitAmount = Math.round(tier.amount * 100);
            const cur = existing.get(meta.variant_id);
            if (cur && cur.unit_amount === unitAmount) {
                // Preserve operational metadata (stock/sku) already set on the Price.
                await stripe.prices.update(cur.id, { metadata: { ...cur.metadata, ...meta } });
                kept.add(cur.id);
            } else {
                const created = await stripe.prices.create({
                    product: product.id,
                    currency: 'usd',
                    unit_amount: unitAmount,
                    tax_behavior: 'exclusive',
                    metadata: meta,
                });
                kept.add(created.id);
            }
        }
        for (const price of existing.values()) {
            if (!kept.has(price.id)) await stripe.prices.update(price.id, { active: false });
        }
        console.log(`✓ ${tier.name} (${product.id}) — ${tier.variants.length} variant(s)`);
    }

    if (!DRY_RUN) {
        console.log('\nSeeded. Next steps:');
        console.log('  1. POST /api/admin/catalog/sync (or wait for webhooks) to refresh the storefront cache.');
        console.log('  2. SET STOCK on every variant (Price metadata `stock`) — unset = unlimited; cap vest stock across both tiers.');
        console.log('  3. Set gift images via the product config (image_url/thumbnail_url) when assets are ready.');
    }
}

main().catch(err => { console.error(err); process.exit(1); });
