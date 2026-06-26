import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { setStock } from '../../../../../lib/inventory';
import { recordAudit } from '../../../../../lib/auditLog';
import { getCatalogVariant, updateVariantStripeMetadata } from '../../../../../lib/catalog';

/**
 * Cycle-count correction (Slice C). SETS a variant's stock to the counted number — a
 * stocktake, NOT a purchase. It must NEVER touch cost basis (that's what `receiveStock`
 * is for); conflating the two would corrupt inventory valuation. Writes the new stock
 * to the variant's Stripe Price metadata (Stripe owns the catalog) AND the inventory
 * overlay cache via `setStock`, audited distinctly as `inventory.count`.
 *
 * Gated on canManageProducts (it changes sell-side availability, like the inventory
 * adjust — not finance, because no money/cost moves).
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { variantId, count } = (await request.json()) as {
        variantId?: string;
        count?: number | null;
    };
    if (!variantId) {
        return NextResponse.json({ error: 'variantId is required' }, { status: 400 });
    }

    const found = await getCatalogVariant(String(variantId));
    if (!found) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    const { product, variant } = found;

    // Normalize: empty/negative/NaN → untracked (unlimited), matching the inventory PATCH.
    const next = count === null || count === undefined || Number.isNaN(count) || count < 0
        ? undefined
        : Math.floor(count);
    const prior = typeof variant.stock === 'number' ? variant.stock : null;

    // Write the counted stock UP to the Stripe Price (null clears it → untracked),
    // then keep the inventory overlay base in step.
    const wrote = await updateVariantStripeMetadata(String(variantId), { stock: next === undefined ? null : next });
    if (!wrote) return NextResponse.json({ error: 'Could not write the count to Stripe' }, { status: 502 });
    await setStock(String(variantId), next === undefined ? null : next);

    void recordAudit({
        action: 'inventory.count',
        actorId: session?.user?.id || 'unknown',
        actorEmail: session?.user?.email || undefined,
        target: String(variantId),
        summary: `Cycle-count "${product.name}" variant ${variantId}: ${prior ?? '∞'} → ${next === undefined ? '∞' : next}`,
        metadata: { productId: product.id, prior, count: next ?? null },
    });

    return NextResponse.json({ ok: true, count: next ?? null });
}
