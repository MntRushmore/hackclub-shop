import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission, getAdminPermissions } from '../../../../lib/adminAuth';
import { loadAllOrders, loadAllProducts, getInventoryValuation } from '../../../../lib/finance';
import { getVariantStocks } from '../../../../lib/inventory';
import { readAudit } from '../../../../lib/auditLog';

export const dynamic = 'force-dynamic';

/**
 * Command-center aggregation: one payload of everything that needs a human, read
 * across the inventory / finance / orders layers.
 *
 * Gated on canViewStats (any admin). Finance-flavored cards (uncosted variants)
 * are only populated when the caller has canManageFinance, mirroring how the
 * finance dashboard hides cost basis from non-finance roles.
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

    const now = Date.now();

    // Each section is independently guarded so one slow/empty layer can't sink the rest.
    const [products, orders, audit] = await Promise.all([
        loadAllProducts().catch(() => []),
        loadAllOrders().catch(() => []),
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
    }> = [];

    for (const p of products) {
        for (const v of p.variants || []) {
            const vid = String(v.variant_id || v.id);
            const available = stocks[vid]?.available;
            if (typeof v.reorderPoint === 'number' && typeof available === 'number' && available <= v.reorderPoint) {
                lowStock.push({
                    productId: p.id,
                    variantId: vid,
                    productName: p.name,
                    variantName: v.name,
                    available,
                    reorderPoint: v.reorderPoint,
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

    // ── Finance alerts (only for finance-trusted roles) ───────────────────────────
    let uncostedVariants = 0;
    if (canFinance) {
        const valuation = await getInventoryValuation().catch(() => null);
        uncostedVariants = valuation?.uncostedVariants ?? 0;
    }

    return NextResponse.json({
        canFinance,
        generatedAt: new Date().toISOString(),
        cards: {
            lowStock: { count: lowStock.length, items: lowStock.slice(0, 6) },
            orders: {
                unfulfilled: unfulfilled.length,
                oldestDays: Math.round(oldestUnfulfilledDays),
            },
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
