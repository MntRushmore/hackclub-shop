import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission, getAdminPermissions } from '../../../../lib/adminAuth';
import { loadAllOrders, loadAllProducts, getInventoryValuation } from '../../../../lib/finance';
import { getVariantStocks } from '../../../../lib/inventory';
import { listQuotes, listPOs, listQuotesByProduct } from '../../../../lib/sourcing';
import { readAudit } from '../../../../lib/auditLog';

export const dynamic = 'force-dynamic';

/**
 * Command-center aggregation: one payload of everything that needs a human, read
 * across the inventory / finance / orders / sourcing layers. The whole point of the
 * connected admin OS — it only works because those layers feed it.
 *
 * Gated on canViewStats (any admin). Finance-flavored cards (uncosted variants,
 * cash/COGS) are only populated when the caller has canManageFinance, mirroring how
 * the finance dashboard hides cost basis from non-finance roles.
 *
 * Fully read-only and fire-and-forget: any layer that throws degrades to an empty
 * card rather than failing the whole dashboard.
 */
const DAYS = 24 * 60 * 60 * 1000;

export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');
    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const perms = await getAdminPermissions(session!.user!.id!);
    const canFinance = Boolean(perms?.canManageFinance);
    const canSourcing = Boolean(perms?.canManageSourcing);
    const canProducts = Boolean(perms?.canManageProducts);

    const now = Date.now();

    // Each section is independently guarded so one slow/empty layer can't sink the rest.
    const [products, orders, quotes, pos, audit] = await Promise.all([
        loadAllProducts().catch(() => []),
        loadAllOrders().catch(() => []),
        canSourcing ? listQuotes().catch(() => []) : Promise.resolve([]),
        canSourcing ? listPOs().catch(() => []) : Promise.resolve([]),
        readAudit(8).catch(() => []),
    ]);

    // ── Reorder / low stock ─────────────────────────────────────────────────────
    // A variant is "low" when it tracks stock, has a reorderPoint, and available <= it.
    const variantIds = products.flatMap((p) =>
        (p.variants || []).map((v) => String(v.variant_id || v.id)),
    );
    const stocks = await getVariantStocks(variantIds).catch(() => ({} as Record<string, { available: number | null }>));

    const lowStock: Array<{
        productId: string;
        variantId: string;
        productName: string;
        variantName: string;
        available: number;
        reorderPoint: number;
        cheapestQuoteId?: string;
        cheapestVendorId?: string;
    }> = [];

    for (const p of products) {
        for (const v of p.variants || []) {
            const vid = String(v.variant_id || v.id);
            const available = stocks[vid]?.available;
            if (typeof v.reorderPoint === 'number' && typeof available === 'number' && available <= v.reorderPoint) {
                // Join to the cheapest OPEN quote for this product, if any (sourcing↔inventory).
                let cheapestQuoteId: string | undefined;
                let cheapestVendorId: string | undefined;
                if (canSourcing) {
                    const productQuotes = (await listQuotesByProduct(p.id).catch(() => [])).filter(
                        (q) => q.status === 'open' || q.status === 'accepted',
                    );
                    let best = Infinity;
                    for (const q of productQuotes) {
                        const min = Math.min(...(q.priceBreaks || []).map((b) => b.unitCost).filter((n) => Number.isFinite(n)));
                        if (Number.isFinite(min) && min < best) {
                            best = min;
                            cheapestQuoteId = q.id;
                            cheapestVendorId = q.vendorId;
                        }
                    }
                }
                lowStock.push({
                    productId: p.id,
                    variantId: vid,
                    productName: p.name,
                    variantName: v.name,
                    available,
                    reorderPoint: v.reorderPoint,
                    cheapestQuoteId,
                    cheapestVendorId,
                });
            }
        }
    }

    // ── Orders needing action ────────────────────────────────────────────────────
    // "Needs shipping": paid + received but not yet shipped out.
    const unfulfilled = orders.filter((o) => o.status === 'received');
    const oldestUnfulfilledDays = unfulfilled.reduce((max, o) => {
        const age = (now - new Date(o.createdAt).getTime()) / DAYS;
        return Math.max(max, age);
    }, 0);

    // ── Quotes expiring soon (open, validUntil within 14 days) ────────────────────
    const expiringQuotes = quotes
        .filter((q) => q.status === 'open' && q.validUntil)
        .map((q) => ({ q, daysLeft: (new Date(q.validUntil as string).getTime() - now) / DAYS }))
        .filter((x) => x.daysLeft <= 14)
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .map((x) => ({
            id: x.q.id,
            itemName: x.q.itemName,
            vendorId: x.q.vendorId,
            validUntil: x.q.validUntil,
            daysLeft: Math.round(x.daysLeft),
        }));

    // ── POs in transit / overdue ──────────────────────────────────────────────────
    const openPOs = pos.filter((p) => p.status === 'issued' || p.status === 'in_transit');
    const overduePOs = openPOs
        .filter((p) => p.expectedDate && new Date(p.expectedDate).getTime() < now)
        .map((p) => ({ id: p.id, vendorId: p.vendorId, expectedDate: p.expectedDate, status: p.status }));

    // ── Finance alerts (only for finance-trusted roles) ───────────────────────────
    let uncostedVariants = 0;
    if (canFinance) {
        const valuation = await getInventoryValuation().catch(() => null);
        uncostedVariants = valuation?.uncostedVariants ?? 0;
    }

    // ── Unlabeled variants (published variants with no barcode SKU yet) ───────────
    // The catalog→label connection surfaced as an action: these can't be scanned to
    // receive until they have a label. Drafts are excluded (not yet sellable/sourced).
    let unlabeledVariants = 0;
    if (canProducts) {
        for (const p of products) {
            if ((p as { draft?: boolean }).draft) continue;
            for (const v of p.variants || []) {
                if (!(v as { sku?: string }).sku) unlabeledVariants++;
            }
        }
    }

    return NextResponse.json({
        canFinance,
        canSourcing,
        canProducts,
        generatedAt: new Date().toISOString(),
        cards: {
            lowStock: { count: lowStock.length, items: lowStock.slice(0, 6) },
            labels: { unlabeledVariants },
            orders: {
                unfulfilled: unfulfilled.length,
                oldestDays: Math.round(oldestUnfulfilledDays),
            },
            expiringQuotes: { count: expiringQuotes.length, items: expiringQuotes.slice(0, 6) },
            overduePOs: { count: overduePOs.length, openCount: openPOs.length, items: overduePOs.slice(0, 6) },
            finance: { uncostedVariants },
            recentActivity: audit.map((a) => ({
                action: a.action,
                summary: a.summary,
                actorEmail: a.actorEmail,
                timestamp: a.timestamp,
            })),
        },
    });
}
