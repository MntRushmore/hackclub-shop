/**
 * Finance: read-only aggregation over orders, products, and the receiving ledger.
 *
 * This is the FINANCE layer's read side — everything the finance dashboard and
 * weekly report show. It never mutates anything and is fully fire-and-forget
 * safe: any Redis hiccup degrades to empty/zero rather than throwing. Read
 * `docs/FINANCE.md` for the costing model and the known approximations.
 *
 * Definitions used throughout:
 *   - On-hand units      = variant.stock (what we PHYSICALLY hold, incl. reserved).
 *   - Inventory value    = Σ on-hand units × variant.unitCost (weighted-avg cost).
 *   - Line COGS          = quantity × (line.unitCost captured at sale, else the
 *                          variant's current cost as an "estimated" fallback).
 *   - Cash revenue       = guest/Stripe order totalAmount (USD). Points orders
 *                          have $0 cash revenue but still incur COGS — we surface
 *                          cash margin and points-fulfillment cost separately so a
 *                          heavy points week doesn't read as a giant loss.
 *   - Test orders (isTest) are excluded from every aggregate, matching the stats route.
 */

import { Redis } from '@upstash/redis';
import { Order } from '../types/Order';
import { Product, ProductVariant } from '../types/Admin';
import { getVariantStocks } from './inventory';
import { readReceipts, Receipt } from './costing';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export type Period = 'week' | 'month' | 'year' | 'all';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Loading ──────────────────────────────────────────────────────────────────

/** All non-test orders across both Redis layouts (student arrays + guest singles). */
export async function loadAllOrders(): Promise<Order[]> {
    const orders: Order[] = [];
    try {
        const studentKeys = await redis.keys('user:*:orders');
        for (const key of studentKeys) {
            const arr = await redis.get<Order[]>(key);
            if (Array.isArray(arr)) orders.push(...arr);
        }
        const guestKeys = await redis.keys('order:*');
        for (const key of guestKeys) {
            const o = await redis.get<Order>(key);
            if (o) orders.push(o);
        }
    } catch (err) {
        console.error('[finance] loadAllOrders failed:', err instanceof Error ? err.message : err);
    }
    return orders.filter((o) => !o.isTest);
}

export async function loadAllProducts(): Promise<Product[]> {
    const products: Product[] = [];
    try {
        const keys = await redis.keys('product:*');
        for (const key of keys) {
            const p = await redis.get<Product>(key);
            if (p) products.push(p);
        }
    } catch (err) {
        console.error('[finance] loadAllProducts failed:', err instanceof Error ? err.message : err);
    }
    return products;
}

/** variantId → variant, for cost fallback + naming. */
function indexVariants(products: Product[]): Map<string, { variant: ProductVariant; product: Product }> {
    const map = new Map<string, { variant: ProductVariant; product: Product }>();
    for (const p of products) {
        for (const v of p.variants || []) {
            map.set(String(v.variant_id || v.id), { variant: v, product: p });
        }
    }
    return map;
}

function periodStart(period: Period, now: Date): Date | null {
    if (period === 'all') return null;
    const d = new Date(now);
    if (period === 'week') d.setDate(now.getDate() - 7);
    else if (period === 'month') d.setMonth(now.getMonth() - 1);
    else if (period === 'year') d.setFullYear(now.getFullYear() - 1);
    return d;
}

// ── Inventory valuation ────────────────────────────────────────────────────────

export interface ValuationRow {
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    category?: string;
    onHand: number | null;     // null = untracked/unlimited (excluded from value)
    unitCost: number | null;   // null = uncosted
    value: number;             // onHand * unitCost, 0 when either is unknown
    costed: boolean;           // false when unitCost is unknown (flags coverage gaps)
}

export interface Valuation {
    rows: ValuationRow[];
    totalValue: number;
    totalUnits: number;            // counted on-hand units across tracked variants
    trackedVariants: number;
    costedVariants: number;        // tracked variants that also have a unit cost
    uncostedVariants: number;      // tracked, on-hand > 0, but no cost set
    untrackedVariants: number;     // unlimited variants (no stock number)
    byCategory: Array<{ category: string; value: number; units: number }>;
}

/**
 * Current inventory valuation: on-hand units × weighted-avg unit cost, per variant,
 * with category rollups and coverage flags. On-hand = variant.stock (reserved units
 * are still ours until a sale commits, so they count toward what we hold).
 */
export async function getInventoryValuation(): Promise<Valuation> {
    const products = await loadAllProducts();
    const variantIds = products.flatMap((p) => (p.variants || []).map((v) => String(v.variant_id || v.id)));
    const stocks = await getVariantStocks(variantIds).catch(() => ({} as Record<string, { stock: number | null }>));

    const rows: ValuationRow[] = [];
    const catMap = new Map<string, { value: number; units: number }>();
    let totalValue = 0;
    let totalUnits = 0;
    let trackedVariants = 0;
    let costedVariants = 0;
    let uncostedVariants = 0;
    let untrackedVariants = 0;

    for (const p of products) {
        for (const v of p.variants || []) {
            const variantId = String(v.variant_id || v.id);
            // Prefer the live inventory base (kept in step with sales) over the
            // product record's snapshot; fall back to the product field.
            const liveStock = stocks[variantId]?.stock;
            const onHand = typeof liveStock === 'number'
                ? liveStock
                : (typeof v.stock === 'number' ? v.stock : null);
            const unitCost = typeof v.unitCost === 'number' ? v.unitCost : null;

            if (onHand === null) {
                untrackedVariants++;
            } else {
                trackedVariants++;
                totalUnits += onHand;
                if (unitCost !== null) costedVariants++;
                else if (onHand > 0) uncostedVariants++;
            }

            const value = onHand !== null && unitCost !== null ? round2(onHand * unitCost) : 0;
            totalValue += value;

            const category = p.category || 'Uncategorized';
            if (value > 0 || (onHand ?? 0) > 0) {
                const c = catMap.get(category) || { value: 0, units: 0 };
                c.value += value;
                c.units += onHand ?? 0;
                catMap.set(category, c);
            }

            rows.push({
                productId: String(p.id),
                variantId,
                productName: p.name,
                variantName: v.name,
                category: p.category,
                onHand,
                unitCost,
                value,
                costed: unitCost !== null,
            });
        }
    }

    rows.sort((a, b) => b.value - a.value);
    const byCategory = Array.from(catMap, ([category, v]) => ({ category, value: round2(v.value), units: v.units }))
        .sort((a, b) => b.value - a.value);

    return {
        rows,
        totalValue: round2(totalValue),
        totalUnits,
        trackedVariants,
        costedVariants,
        uncostedVariants,
        untrackedVariants,
        byCategory,
    };
}

// ── COGS & margin ──────────────────────────────────────────────────────────────

/** Resolve a sold line's per-unit cost: captured-at-sale first, else current variant cost. */
function lineUnitCost(
    item: Order['items'][number],
    variants: Map<string, { variant: ProductVariant; product: Product }>,
): { cost: number; estimated: boolean } {
    if (typeof item.unitCost === 'number' && item.unitCost >= 0) {
        return { cost: item.unitCost, estimated: false };
    }
    if (item.variantId) {
        const v = variants.get(String(item.variantId));
        if (v && typeof v.variant.unitCost === 'number') return { cost: v.variant.unitCost, estimated: true };
    }
    return { cost: 0, estimated: true };
}

export interface MarginProductRow {
    name: string;
    variantId?: string;
    unitsSold: number;
    revenue: number;     // cash (USD); points lines contribute 0
    cogs: number;
    margin: number;      // revenue - cogs
    marginPct: number | null;
}

export interface CogsAndMargin {
    period: Period;
    // Cash pathway (guest/Stripe): the real P&L line.
    cashRevenue: number;
    cashCogs: number;
    cashMargin: number;        // cashRevenue - cashCogs
    cashMarginPct: number | null;
    // Points pathway: $0 cash revenue, but real money was spent fulfilling them.
    pointsCogs: number;
    pointsSpent: number;       // points (not USD)
    pointsOrders: number;
    // Combined COGS (cash + points) — total cost of everything that left the door.
    totalCogs: number;
    unitsSold: number;
    ordersCounted: number;
    estimatedLineShare: number; // fraction of COGS lines that used the fallback cost
    byProduct: MarginProductRow[];
    topByMargin: MarginProductRow[];
    bottomByMargin: MarginProductRow[];
}

export async function getCogsAndMargin(period: Period = 'all', now = new Date()): Promise<CogsAndMargin> {
    const [orders, products] = await Promise.all([loadAllOrders(), loadAllProducts()]);
    const variants = indexVariants(products);
    const start = periodStart(period, now);

    // Only orders that represent a real sale: paid (or fulfilled/approved) — never
    // unpaid/abandoned guest sessions or denied/refunded orders.
    const sold = orders.filter((o) => {
        if (start && new Date(o.createdAt) < start) return false;
        if (o.paymentStatus === 'refunded') return false;
        if (o.status === 'denied' || o.status === 'refunded') return false;
        if (o.pathway === 'guest') return o.paymentStatus === 'paid';
        return true; // student/points orders settle in-request
    });

    let cashRevenue = 0;
    let cashCogs = 0;
    let pointsCogs = 0;
    let pointsSpent = 0;
    let pointsOrders = 0;
    let unitsSold = 0;
    let estimatedLines = 0;
    let totalLines = 0;
    const productAgg = new Map<string, MarginProductRow>();

    for (const o of sold) {
        const isCash = o.pathway === 'guest';
        if (!isCash) pointsOrders++;
        if (!isCash) pointsSpent += o.pointsSpent || 0;

        for (const item of o.items || []) {
            const qty = item.quantity || 0;
            if (qty <= 0) continue;
            totalLines++;
            const { cost, estimated } = lineUnitCost(item, variants);
            if (estimated) estimatedLines++;
            const lineCogs = round2(cost * qty);
            const lineRevenue = isCash ? round2(parseFloat(item.price || '0') * qty) : 0;

            unitsSold += qty;
            if (isCash) {
                cashRevenue += lineRevenue;
                cashCogs += lineCogs;
            } else {
                pointsCogs += lineCogs;
            }

            const key = item.variantId ? String(item.variantId) : item.name;
            const row = productAgg.get(key) || {
                name: item.name,
                variantId: item.variantId ? String(item.variantId) : undefined,
                unitsSold: 0, revenue: 0, cogs: 0, margin: 0, marginPct: null,
            };
            row.unitsSold += qty;
            row.revenue += lineRevenue;
            row.cogs += lineCogs;
            productAgg.set(key, row);
        }
    }

    const byProduct = Array.from(productAgg.values()).map((r) => {
        const revenue = round2(r.revenue);
        const cogs = round2(r.cogs);
        const margin = round2(revenue - cogs);
        return { ...r, revenue, cogs, margin, marginPct: revenue > 0 ? round2((margin / revenue) * 100) : null };
    }).sort((a, b) => b.margin - a.margin);

    cashRevenue = round2(cashRevenue);
    cashCogs = round2(cashCogs);
    pointsCogs = round2(pointsCogs);
    const cashMargin = round2(cashRevenue - cashCogs);

    return {
        period,
        cashRevenue,
        cashCogs,
        cashMargin,
        cashMarginPct: cashRevenue > 0 ? round2((cashMargin / cashRevenue) * 100) : null,
        pointsCogs,
        pointsSpent,
        pointsOrders,
        totalCogs: round2(cashCogs + pointsCogs),
        unitsSold,
        ordersCounted: sold.length,
        estimatedLineShare: totalLines > 0 ? round2(estimatedLines / totalLines) : 0,
        byProduct,
        topByMargin: byProduct.slice(0, 10),
        bottomByMargin: byProduct.filter((r) => r.revenue > 0).slice(-10).reverse(),
    };
}

// ── Receiving spend ──────────────────────────────────────────────────────────

export interface Spend {
    period: Period;
    totalSpend: number;
    receiptCount: number;
    unitsReceived: number;
}

export async function getSpend(period: Period = 'all', now = new Date()): Promise<Spend> {
    const receipts = await readReceipts(2000);
    const start = periodStart(period, now);
    const inPeriod = receipts.filter((r) => !start || new Date(r.receivedAt) >= start);
    return {
        period,
        totalSpend: round2(inPeriod.reduce((s, r) => s + (r.totalCost || 0), 0)),
        receiptCount: inPeriod.length,
        unitsReceived: inPeriod.reduce((s, r) => s + (r.quantity || 0), 0),
    };
}

// ── Time series (for charts) ───────────────────────────────────────────────────

/** ISO week key (YYYY-Www) and the week's Monday 00:00 (local). */
export function isoWeek(d: Date): { key: string; start: Date } {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = date.getUTCDay() || 7;            // Mon=1..Sun=7
    date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const sDay = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - (sDay - 1));
    start.setUTCHours(0, 0, 0, 0);
    return { key: `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start };
}

export interface WeekPoint {
    week: string;           // ISO week key
    weekStart: string;      // ISO date (Monday)
    cashRevenue: number;
    cashCogs: number;
    cashMargin: number;
    pointsCogs: number;
    spend: number;
    unitsSold: number;
    unitsReceived: number;
    orders: number;
}

/** Weekly series over the trailing `weeks` ISO weeks (oldest → newest). */
export async function getWeeklySeries(weeks = 12, now = new Date()): Promise<WeekPoint[]> {
    const [orders, products, receipts] = await Promise.all([loadAllOrders(), loadAllProducts(), readReceipts(2000)]);
    const variants = indexVariants(products);

    const buckets = new Map<string, WeekPoint>();
    const ensure = (d: Date) => {
        const { key, start } = isoWeek(d);
        let b = buckets.get(key);
        if (!b) {
            b = { week: key, weekStart: start.toISOString().slice(0, 10), cashRevenue: 0, cashCogs: 0, cashMargin: 0, pointsCogs: 0, spend: 0, unitsSold: 0, unitsReceived: 0, orders: 0 };
            buckets.set(key, b);
        }
        return b;
    };

    for (const o of orders) {
        const isCash = o.pathway === 'guest';
        if (isCash && o.paymentStatus !== 'paid') continue;
        if (o.paymentStatus === 'refunded' || o.status === 'denied' || o.status === 'refunded') continue;
        const b = ensure(new Date(o.createdAt));
        b.orders++;
        for (const item of o.items || []) {
            const qty = item.quantity || 0;
            if (qty <= 0) continue;
            const { cost } = lineUnitCost(item, variants);
            b.unitsSold += qty;
            if (isCash) {
                b.cashRevenue = round2(b.cashRevenue + parseFloat(item.price || '0') * qty);
                b.cashCogs = round2(b.cashCogs + cost * qty);
            } else {
                b.pointsCogs = round2(b.pointsCogs + cost * qty);
            }
        }
        b.cashMargin = round2(b.cashRevenue - b.cashCogs);
    }

    for (const r of receipts) {
        const b = ensure(new Date(r.receivedAt));
        b.spend = round2(b.spend + (r.totalCost || 0));
        b.unitsReceived += r.quantity || 0;
    }

    // Trailing N weeks ending this week, filling empty weeks with zeros so charts
    // don't have gaps.
    const series: WeekPoint[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i * 7);
        const { key, start } = isoWeek(d);
        series.push(buckets.get(key) || {
            week: key, weekStart: start.toISOString().slice(0, 10),
            cashRevenue: 0, cashCogs: 0, cashMargin: 0, pointsCogs: 0, spend: 0, unitsSold: 0, unitsReceived: 0, orders: 0,
        });
    }
    return series;
}

// ── Weekly report (the finance headline) ────────────────────────────────────────

export interface DeadStockRow {
    variantId: string;
    productName: string;
    variantName: string;
    onHand: number;
    value: number;
    lastSold: string | null;   // ISO date or null if never sold
}

export interface WeeklyReport {
    week: string;
    weekStart: string;
    weekEnd: string;
    // Sales
    unitsSold: number;
    cashRevenue: number;
    cashCogs: number;
    cashMargin: number;
    cashMarginPct: number | null;
    pointsCogs: number;
    pointsSpent: number;
    orders: number;
    // Purchasing
    unitsReceived: number;
    spend: number;
    receiptCount: number;
    // Position at report time
    endingInventoryValue: number;
    lowStock: Array<{ variantId: string; productName: string; variantName: string; available: number | null }>;
    deadStock: DeadStockRow[];   // on-hand value but no sale in the dead-stock window
    uncostedVariants: number;
}

const LOW_STOCK_THRESHOLD = 5;
const DEAD_STOCK_WEEKS = 8;

/**
 * One ISO-week rollup — the artifact the finance team reads. `weekContaining` is
 * any date inside the desired week (defaults to now). Combines that week's sales,
 * COGS/margin, and purchasing with the current inventory position, low-stock, and
 * dead-stock flags.
 */
export async function getWeeklyReport(weekContaining = new Date()): Promise<WeeklyReport> {
    const { key, start } = isoWeek(weekContaining);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7); // exclusive upper bound

    const [orders, products, receipts, valuation] = await Promise.all([
        loadAllOrders(), loadAllProducts(), readReceipts(2000), getInventoryValuation(),
    ]);
    const variants = indexVariants(products);

    const inWeek = (iso: string | Date) => {
        const t = new Date(iso).getTime();
        return t >= start.getTime() && t < end.getTime();
    };

    let unitsSold = 0, cashRevenue = 0, cashCogs = 0, pointsCogs = 0, pointsSpent = 0, orderCount = 0;
    const lastSoldByVariant = new Map<string, number>();

    for (const o of orders) {
        const isCash = o.pathway === 'guest';
        if (isCash && o.paymentStatus !== 'paid') continue;
        if (o.paymentStatus === 'refunded' || o.status === 'denied' || o.status === 'refunded') continue;
        const ts = new Date(o.createdAt).getTime();
        for (const item of o.items || []) {
            if (item.variantId) {
                const prev = lastSoldByVariant.get(String(item.variantId)) || 0;
                if (ts > prev) lastSoldByVariant.set(String(item.variantId), ts);
            }
        }
        if (!inWeek(o.createdAt)) continue;
        orderCount++;
        if (!isCash) pointsSpent += o.pointsSpent || 0;
        for (const item of o.items || []) {
            const qty = item.quantity || 0;
            if (qty <= 0) continue;
            const { cost } = lineUnitCost(item, variants);
            unitsSold += qty;
            if (isCash) {
                cashRevenue = round2(cashRevenue + parseFloat(item.price || '0') * qty);
                cashCogs = round2(cashCogs + cost * qty);
            } else {
                pointsCogs = round2(pointsCogs + cost * qty);
            }
        }
    }

    const weekReceipts = receipts.filter((r) => inWeek(r.receivedAt));
    const spend = round2(weekReceipts.reduce((s, r) => s + (r.totalCost || 0), 0));
    const unitsReceived = weekReceipts.reduce((s, r) => s + (r.quantity || 0), 0);

    // Low stock from the operational layer.
    const variantIds = products.flatMap((p) => (p.variants || []).map((v) => String(v.variant_id || v.id)));
    const stocks = await getVariantStocks(variantIds).catch(() => ({} as Record<string, { available: number | null }>));
    const lowStock = valuation.rows
        .map((r) => ({ ...r, available: stocks[r.variantId]?.available ?? null }))
        .filter((r) => r.available !== null && r.available <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => (a.available ?? 0) - (b.available ?? 0))
        .slice(0, 50)
        .map((r) => ({ variantId: r.variantId, productName: r.productName, variantName: r.variantName, available: r.available }));

    // Dead stock: holds value but hasn't sold in the dead-stock window.
    const deadCutoff = Date.now() - DEAD_STOCK_WEEKS * 7 * 86400000;
    const deadStock: DeadStockRow[] = valuation.rows
        .filter((r) => r.value > 0)
        .filter((r) => {
            const last = lastSoldByVariant.get(r.variantId);
            return !last || last < deadCutoff;
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 50)
        .map((r) => ({
            variantId: r.variantId,
            productName: r.productName,
            variantName: r.variantName,
            onHand: r.onHand ?? 0,
            value: r.value,
            lastSold: lastSoldByVariant.has(r.variantId)
                ? new Date(lastSoldByVariant.get(r.variantId)!).toISOString().slice(0, 10)
                : null,
        }));

    const cashMargin = round2(cashRevenue - cashCogs);

    return {
        week: key,
        weekStart: start.toISOString().slice(0, 10),
        weekEnd: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
        unitsSold,
        cashRevenue,
        cashCogs,
        cashMargin,
        cashMarginPct: cashRevenue > 0 ? round2((cashMargin / cashRevenue) * 100) : null,
        pointsCogs,
        pointsSpent,
        orders: orderCount,
        unitsReceived,
        spend,
        receiptCount: weekReceipts.length,
        endingInventoryValue: valuation.totalValue,
        lowStock,
        deadStock,
        uncostedVariants: valuation.uncostedVariants,
    };
}

// ── Dashboard overview (one call powers the KPIs + charts) ──────────────────────

export interface FinanceOverview {
    period: Period;
    valuation: Valuation;
    margin: CogsAndMargin;
    spend: Spend;
    weeklySeries: WeekPoint[];
    generatedAt: string;
}

export async function getFinanceOverview(period: Period = 'month', now = new Date()): Promise<FinanceOverview> {
    const [valuation, margin, spend, weeklySeries] = await Promise.all([
        getInventoryValuation(),
        getCogsAndMargin(period, now),
        getSpend(period, now),
        getWeeklySeries(12, now),
    ]);
    return { period, valuation, margin, spend, weeklySeries, generatedAt: now.toISOString() };
}

export type { Receipt };
