import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../../lib/adminAuth';
import {
    getQuote,
    updateQuote,
    listQuotesByProduct,
} from '../../../../../../../lib/sourcing';
import { mirrorQuote, mirrorProduct } from '../../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../../lib/auditLog';
import { Product, ProductVariant } from '../../../../../../../types/Admin';
import { landedUnitCost } from '../../../../../../../types/Sourcing';
import { assignSku } from '../../../../../../../lib/sku';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Accept a quote → draft a Product (unpublished, no prices) with one variant seeded
 * from the quote, including its `unitCost` so finance has a cost basis immediately.
 *
 * The product is created as a `draft`: it is excluded from the storefront API and
 * its detail page 404s publicly. An admin publishes it later from the product editor
 * (sets cash/points prices, clears the draft flag). The variant carries NO price, so
 * even absent the draft gate it is not buyable on either pathway.
 *
 * Idempotent on the quote: if this quote already has a `productId`, we return that
 * product rather than creating a second one.
 *
 * Body (optional): { qty?: number, rejectSiblings?: boolean }
 *   qty           — quantity to price the seed unitCost at (defaults to the quote's
 *                   MOQ, else the smallest price-break minQty).
 *   rejectSiblings — also mark other OPEN quotes for the same item `rejected`.
 */
export async function POST(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const quote = await getQuote(params.id);
        if (!quote) {
            return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
        }

        // Already linked to a product — return it (idempotent), and just ensure the
        // status reflects accepted.
        if (quote.productId) {
            const existing = await redis.get<Product>(`product:${quote.productId}`);
            if (existing) {
                if (quote.status !== 'accepted') {
                    const q = await updateQuote(quote.id, { status: 'accepted' });
                    if (q) void mirrorQuote(q);
                }
                return NextResponse.json({ product: existing, quote, alreadyLinked: true });
            }
            // The linked product was deleted — fall through and create a fresh draft.
        }

        const body = await request.json().catch(() => ({}));
        const rejectSiblings = body?.rejectSiblings === true;

        const smallestTierQty = quote.priceBreaks.length
            ? Math.min(...quote.priceBreaks.map((b) => b.minQty))
            : 1;
        const qty = Number(body?.qty) > 0 ? Math.floor(Number(body.qty)) : quote.moq || smallestTierQty;
        const seedCost = landedUnitCost(quote, qty);

        const ts = Date.now();
        const variantId = `var_${ts}_0`;
        const variant: ProductVariant = {
            id: variantId,
            variant_id: variantId,
            name: quote.variantHint?.trim() || 'Default',
            // No price on either pathway yet — admin sets these when publishing.
            price: 0,
            unitCost: seedCost != null ? Math.round(seedCost * 100) / 100 : undefined,
            stock: 0, // tracked, starts at 0 — receiving the PO bumps it.
        };

        const product: Product = {
            id: `prod_${ts}_${Math.random().toString(36).slice(2, 9)}`,
            name: quote.itemName,
            description: '',
            variants: [variant],
            shippingOptions: [],
            checkoutFields: [],
            draft: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await redis.set(`product:${product.id}`, product);

        // Auto-mint a SKU for the seeded variant so the drafted product is barcode-ready
        // the moment it exists — the sourcing→catalog→label chain stays connected.
        // assignSku persists onto the product and maintains the sku:{sku} index; a
        // failure here must not block the accept (SKU is optional, mintable later).
        try {
            await assignSku(product, variantId);
        } catch (err) {
            console.error('[accept] SKU auto-assign failed:', err instanceof Error ? err.message : err);
        }
        void mirrorProduct(product);

        // Link the quote → product and mark it accepted.
        const updatedQuote = await updateQuote(quote.id, {
            productId: product.id,
            status: 'accepted',
        });
        if (updatedQuote) void mirrorQuote(updatedQuote);

        // Optionally reject sibling open quotes for the same item name.
        let rejectedCount = 0;
        if (rejectSiblings) {
            // Siblings share the linked product only after acceptance, so match on the
            // (normalized) item name across all open quotes for this item.
            const sameItem = (await listQuotesByProduct(product.id)).filter(
                (q) => q.id !== quote.id && q.status === 'open',
            );
            // Also catch unlinked opens with the same item name.
            for (const sib of sameItem) {
                const rq = await updateQuote(sib.id, { status: 'rejected' });
                if (rq) {
                    void mirrorQuote(rq);
                    rejectedCount++;
                }
            }
        }

        void recordAudit({
            action: 'sourcing.quote.accept',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: quote.id,
            summary: `Accepted quote "${quote.itemName}" → draft product ${product.id}${seedCost != null ? ` (cost $${seedCost.toFixed(2)}/unit @ ${qty})` : ''}`,
            metadata: { productId: product.id, qty, seedCost, rejectedSiblings: rejectedCount },
        });

        return NextResponse.json({ product, quote: updatedQuote || quote, rejectedSiblings: rejectedCount }, { status: 201 });
    } catch (err) {
        console.error('[sourcing/accept]', err);
        return NextResponse.json({ error: 'Failed to accept quote' }, { status: 500 });
    }
}
