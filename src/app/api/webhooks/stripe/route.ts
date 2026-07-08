import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, isStripeConfigured, webhookSecretFor, type StripeMode } from '../../../../lib/stripe';
import { getGuestOrder, getGuestOrderBySession, updateGuestOrder, deleteGuestOrder } from '../../../../lib/guestOrders';
import { mirrorOrder } from '../../../../lib/airtableMirror';
import { sendEmail, buildOrderConfirmation, buildAdminNewOrder } from '../../../../lib/email';
import { commitReserved, release, claimOrderSettlement } from '../../../../lib/inventory';
import { recordDonation, recordDonationEntry, bumpImpact } from '../../../../lib/donorWall';
import { getStripe as getStripeClient } from '../../../../lib/stripe';
import { CATALOG_MANAGED_FLAG } from '../../../../lib/catalogMapping';
import { buildCatalogProduct, putCatalogCache, dropCatalogCache } from '../../../../lib/catalog';

/**
 * Stripe webhook — the ONLY trusted signal that a guest order was paid. The
 * success redirect is never treated as proof of payment; finalization happens
 * here after verifying the signature against the webhook secret.
 *
 * Both the live and test key slots point their webhook endpoints here. The
 * signature is checked against each configured secret (STRIPE_WEBHOOK_SECRET,
 * then STRIPE_WEBHOOK_SECRET_TEST); whichever verifies identifies the slot the
 * event came from. Test-slot events finalize their (isTest-stamped) orders and
 * release holds exactly like live ones, but never touch live aggregates: no
 * donor-wall entries, no impact bumps, no admin new-order alert, and no
 * catalog-cache writes (the live account's products are the storefront's
 * source of truth).
 */

// Stripe needs the raw, unparsed request body to verify the signature.
export const runtime = 'nodejs';

export async function POST(request: Request) {
    const slots = (['live', 'test'] as StripeMode[])
        .map((m) => ({ mode: m, secret: webhookSecretFor(m) }))
        .filter((s) => Boolean(s.secret));
    if (slots.length === 0) {
        console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET not set');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const sig = request.headers.get('stripe-signature');
    if (!sig) {
        return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const rawBody = await request.text();

    // constructEvent is pure HMAC — any constructible client can verify, so use
    // whichever key slot exists even if it isn't the slot the event came from.
    const verifier = getStripe(isStripeConfigured('live') ? 'live' : 'test');

    let event: Stripe.Event | null = null;
    let eventMode: StripeMode = 'live';
    for (const slot of slots) {
        try {
            event = verifier.webhooks.constructEvent(rawBody, sig, slot.secret!);
            eventMode = slot.mode;
            break;
        } catch {
            // Try the next configured slot's secret.
        }
    }
    if (!event) {
        console.error('[Stripe webhook] Signature verification failed for all configured secrets');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    const isLiveEvent = eventMode === 'live';

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;

                // Sustainer subscription start: no shop order exists — write the
                // donor-wall entry + first month's impact directly. The claim
                // makes duplicate deliveries no-ops.
                if (session.mode === 'subscription' && session.metadata?.sustainer === '1') {
                    if (session.payment_status !== 'paid') break;
                    // Test-slot sustainer signups never reach the public wall.
                    if (!isLiveEvent) break;
                    if (!(await claimOrderSettlement(`sustain:${session.id}`))) break;
                    const wallName = session.custom_fields
                        ?.find((f) => f.key === 'donor_wall_name')?.text?.value?.trim()
                        .slice(0, 60) || undefined;
                    await recordDonationEntry({
                        orderId: `sustain_${session.id}`,
                        tier: 'Sustainer',
                        fundId: 'general',
                        amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : 25,
                        displayName: wallName,
                        isAnonymous: false,
                        donatedAt: new Date().toISOString(),
                    });
                    break;
                }

                const orderId = session.metadata?.orderId;

                // Resolve the order by metadata first, then by the session-id pointer.
                let order = orderId ? await getGuestOrder(orderId) : null;
                if (!order) order = await getGuestOrderBySession(session.id);
                if (!order) {
                    console.error('[Stripe webhook] No order for session', session.id);
                    break;
                }

                // Only finalize when the money actually settled. checkout.session.
                // completed can also fire for unpaid/async-pending or $0
                // (no_payment_required) sessions; those must not flip the order to
                // paid or commit stock. (Async methods would later send
                // checkout.session.async_payment_succeeded — not handled today as
                // the shop is card-only, but this guard keeps us correct if one is
                // ever enabled.)
                if (session.payment_status !== 'paid') break;

                // Idempotent: ignore if already finalized.
                if (order.paymentStatus === 'paid') break;

                // Claim the settlement atomically (SET NX) so a duplicate or
                // concurrent delivery can't double-commit stock OR double-send the
                // confirmation/mirror — the paymentStatus check above is read-then-
                // write, not atomic across deliveries. Only the first delivery to
                // win the claim proceeds; later ones no-op here.
                if (!(await claimOrderSettlement(order.id))) break;

                // Convert the held reservation into a sale (decrements base stock).
                if (order.inventoryHold && order.inventoryHold.length > 0) {
                    await commitReserved(order.inventoryHold);
                }

                const email = order.guestEmail || session.customer_details?.email || undefined;
                // Stripe's amount_total is the authoritative charged total — with
                // Stripe Tax on, it includes sales tax that wasn't known when the
                // order was created. Write it back (and the tax line) so the order,
                // receipts, and finance reporting reflect what the customer paid.
                const amountTotal = typeof session.amount_total === 'number'
                    ? session.amount_total / 100
                    : order.totalAmount;
                const taxAmount = typeof session.total_details?.amount_tax === 'number'
                    ? session.total_details.amount_tax / 100
                    : undefined;

                const donation = order.donation;

                const updated = await updateGuestOrder(order.id, {
                    paymentStatus: 'paid',
                    status: 'received',
                    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
                    totalAmount: amountTotal,
                    ...(taxAmount !== undefined ? { taxAmount } : {}),
                    ...(donation ? { donation } : {}),
                    guestEmail: email,
                    statusHistory: [
                        ...order.statusHistory,
                        { status: 'received', timestamp: new Date(), message: 'Payment received via Stripe' },
                    ],
                });

                if (updated) {
                    // Donor wall + impact meters (server-only write; no-op for
                    // non-donation orders, best-effort on Redis hiccups). Test
                    // orders never reach the public wall or the meters.
                    if (isLiveEvent && !updated.isTest) void recordDonation(updated);
                    // Mirror still runs for test orders — the sheet has an Is Test
                    // column, so the record matches what admins see in the shop.
                    void mirrorOrder(updated);
                    // Confirm to the customer (the tester wants to see the receipt),
                    // but don't page staff about a test order.
                    if (email) void sendEmail(buildOrderConfirmation(updated, email));
                    if (isLiveEvent && !updated.isTest) {
                        const adminMsg = buildAdminNewOrder(updated);
                        if (adminMsg) void sendEmail(adminMsg);
                    }
                }
                break;
            }
            case 'invoice.paid': {
                // Monthly renewal (Sustainer OR a monthly donation tier): bump
                // wall entry — the donor is already on the wall). The first
                // invoice (billing_reason=subscription_create) is counted by
                // checkout.session.completed above, so only cycles count here.
                const invoice = event.data.object as Stripe.Invoice;
                if (invoice.billing_reason !== 'subscription_cycle') break;
                // Subscription metadata is snapshotted onto the invoice's parent
                // details, so no extra Stripe read is needed to identify ours.
                const subMeta = invoice.parent?.subscription_details?.metadata;
                if (subMeta?.sustainer !== '1' && subMeta?.donation !== '1') break;
                // Test-slot renewals must not inflate the public impact meters.
                if (!isLiveEvent) break;
                if (!(await claimOrderSettlement(`invoice:${invoice.id}`))) break;
                await bumpImpact(subMeta.fund || 'general', invoice.amount_paid / 100);
                break;
            }
            case 'checkout.session.expired': {
                const session = event.data.object as Stripe.Checkout.Session;
                const order = await getGuestOrderBySession(session.id);
                if (order && order.paymentStatus === 'unpaid') {
                    // The guest never paid, so this was never a real order. Free the
                    // held units (one-time claim so a duplicate expiry can't race a
                    // late completion) and delete the record so it doesn't clog admin.
                    if (order.inventoryHold && order.inventoryHold.length > 0) {
                        if (await claimOrderSettlement(order.id)) {
                            await release(order.inventoryHold);
                        }
                    }
                    await deleteGuestOrder(order.id);
                }
                break;
            }
            // ---- Catalog sync: Stripe is the source of truth for products/prices.
            // Any edit in the Stripe Dashboard refreshes that product's cache entry
            // so the storefront/checkout projection stays current. LIVE slot only:
            // the test account's products must never overwrite the live catalog.
            case 'product.created':
            case 'product.updated': {
                if (!isLiveEvent) break;
                const product = event.data.object as Stripe.Product;
                if (product.metadata?.managed_by !== CATALOG_MANAGED_FLAG) break;
                if (product.active === false || product.deleted) {
                    await dropCatalogCache(product.metadata.shop_product_id || product.id);
                    break;
                }
                await refreshProductCache(product.id);
                break;
            }
            case 'product.deleted': {
                if (!isLiveEvent) break;
                const product = event.data.object as Stripe.Product;
                if (product.metadata?.managed_by !== CATALOG_MANAGED_FLAG) break;
                await dropCatalogCache(product.metadata.shop_product_id || product.id);
                break;
            }
            case 'price.created':
            case 'price.updated':
            case 'price.deleted': {
                if (!isLiveEvent) break;
                // A price change can flip a variant's availability/amount. Reproject
                // the owning product from Stripe so the variant list is rebuilt.
                const price = event.data.object as Stripe.Price;
                if (price.metadata?.managed_by !== CATALOG_MANAGED_FLAG) break;
                const productId = typeof price.product === 'string' ? price.product : price.product?.id;
                if (productId) await refreshProductCache(productId);
                break;
            }
            default:
                // Ignore unrelated event types.
                break;
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('[Stripe webhook] Handler error:', error);
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }
}

/**
 * Reproject one managed Stripe Product (and its active Prices) into the catalog
 * cache. Best-effort: a Stripe/Redis hiccup logs and leaves the prior cache entry
 * in place rather than blanking the product. Called by the catalog webhook cases.
 */
async function refreshProductCache(stripeProductId: string): Promise<void> {
    try {
        const stripe = getStripeClient();
        const product = await stripe.products.retrieve(stripeProductId);
        if (product.metadata?.managed_by !== CATALOG_MANAGED_FLAG) return;

        const prices: Array<{ id: string; unit_amount: number | null; active: boolean; metadata: Record<string, string> }> = [];
        for await (const price of stripe.prices.list({ product: stripeProductId, limit: 100 })) {
            prices.push({ id: price.id, unit_amount: price.unit_amount, active: price.active, metadata: price.metadata || {} });
        }
        const catalogProduct = buildCatalogProduct(
            { id: product.id, name: product.name, description: product.description, created: product.created, metadata: product.metadata || {} },
            prices,
        );
        await putCatalogCache(catalogProduct);
    } catch (err) {
        console.error('[Stripe webhook] catalog refresh failed for', stripeProductId, ':', err instanceof Error ? err.message : err);
    }
}
