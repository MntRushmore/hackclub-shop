'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageHeader, Card, ErrorBanner, LoadingScreen, EmptyState } from '../ui';

/**
 * Warehouse operations: what ships today and what to pull off the shelves.
 * Read-only over the order queue; label buying stays on the Orders page
 * (ShippingPanel). Packing slips print from here so the pack bench doesn't
 * need the full orders admin open.
 */

interface ShipFrom {
    name: string; company: string | null; street1: string | null; street2: string | null;
    city: string | null; state: string | null; zip: string | null; country: string; phone: string | null;
    configured: boolean; missing: string[];
}
interface QueueAddress { name: string; line1: string; line2?: string; city: string; state: string; postal_code: string; country: string }
interface QueueItem { name: string; quantity: number; variantId: string | null }
interface QueueOrder {
    id: string; pathway: 'student' | 'guest'; buyer: string; createdAt: string;
    shippingAddress: QueueAddress | null; items: QueueItem[];
    paidShipping: { carrier: string; service: string; cost: number | null } | null;
    vestNumber: number | null;
}
interface PickRow { variantId: string | null; name: string; quantity: number; orders: number; onHand: number | null }
interface WarehouseData {
    shipFrom: ShipFrom; easypostConfigured: boolean; defaultParcelOz: number;
    queue: QueueOrder[]; pickList: PickRow[]; generatedAt: string;
}

const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function WarehouseAdmin() {
    const [data, setData] = useState<WarehouseData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/warehouse');
                if (!res.ok) {
                    setError(res.status === 403 ? 'You don’t have permission to view the warehouse.' : 'Failed to load warehouse data');
                    return;
                }
                setData(await res.json());
            } catch {
                setError('Failed to load warehouse data');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <>
            <PageHeader
                title="Warehouse"
                subtitle="The ship queue and pick list for warehouse staff. Buy labels from the Orders page; print packing slips here."
                actions={data && data.queue.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => printPackingSlips(data.queue, data.shipFrom)}
                        className="rounded-lg bg-hackclub-blue px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-600"
                    >
                        Print all packing slips
                    </button>
                ) : undefined}
            />

            {error && <ErrorBanner message={error} />}
            {loading && !data && <LoadingScreen />}

            {data && (
                <>
                    <ShipFromCard shipFrom={data.shipFrom} easypostConfigured={data.easypostConfigured} defaultParcelOz={data.defaultParcelOz} />
                    <QueueStats queue={data.queue} pickList={data.pickList} />
                    <PickListCard rows={data.pickList} />
                    <QueueCard queue={data.queue} shipFrom={data.shipFrom} />
                </>
            )}
        </>
    );
}

// ── Ship-from (warehouse origin) ──────────────────────────────────────────────
function ShipFromCard({ shipFrom, easypostConfigured, defaultParcelOz }: { shipFrom: ShipFrom; easypostConfigured: boolean; defaultParcelOz: number }) {
    const dot = shipFrom.configured ? 'bg-green-500' : 'bg-hackclub-orange';
    return (
        <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
                <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${dot}`} aria-hidden="true" />
                <div>
                    <p className="font-black text-hackclub-dark flex items-center gap-2 flex-wrap">
                        Ship-from address
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${easypostConfigured ? 'bg-hackclub-green/10 text-hackclub-green' : 'bg-hackclub-snow text-hackclub-muted'}`}>
                            {easypostConfigured ? 'EasyPost connected' : 'Manual labels'}
                        </span>
                    </p>
                    {shipFrom.configured ? (
                        <p className="text-sm text-hackclub-slate">
                            Labels ship from <span className="font-bold text-hackclub-dark">{shipFrom.company || shipFrom.name}</span>,{' '}
                            {[shipFrom.street1, shipFrom.street2, shipFrom.city, shipFrom.state, shipFrom.zip].filter(Boolean).join(', ')}
                        </p>
                    ) : (
                        <p className="text-sm text-hackclub-orange font-bold">
                            The warehouse address is incomplete: set SHIP_FROM_{shipFrom.missing.map((m) => m.toUpperCase()).join(', SHIP_FROM_')}.
                            Rate quotes and labels fail until every field is set.
                        </p>
                    )}
                    <p className="text-sm text-hackclub-slate mt-1">
                        Default parcel weight {defaultParcelOz} oz when a cart has no per-item weights.
                    </p>
                </div>
            </div>
        </Card>
    );
}

// ── Queue KPIs ────────────────────────────────────────────────────────────────
function QueueStats({ queue, pickList }: { queue: QueueOrder[]; pickList: PickRow[] }) {
    const units = pickList.reduce((n, r) => n + r.quantity, 0);
    const oldest = queue.length ? ageDays(queue[0].createdAt) : 0;
    const short = pickList.filter((r) => r.onHand !== null && r.onHand < r.quantity).length;
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label="Orders to ship" value={String(queue.length)} />
            <Stat label="Units to pull" value={String(units)} />
            <Stat label="Oldest order" value={queue.length ? `${oldest}d` : 'none'} tone={oldest >= 5 ? 'red' : oldest >= 2 ? 'orange' : 'dark'} />
            <Stat label="Short on stock" value={String(short)} tone={short > 0 ? 'red' : 'green'} />
        </div>
    );
}

function Stat({ label, value, tone = 'dark' }: { label: string; value: string; tone?: 'dark' | 'green' | 'red' | 'orange' }) {
    const c = { dark: 'text-hackclub-dark', green: 'text-hackclub-green', red: 'text-hackclub-red', orange: 'text-hackclub-orange' }[tone];
    return (
        <Card>
            <div className="text-xs font-black uppercase text-hackclub-muted tracking-wide">{label}</div>
            <div className={`text-3xl font-black mt-1 ${c}`}>{value}</div>
        </Card>
    );
}

// ── Pick list ─────────────────────────────────────────────────────────────────
function PickListCard({ rows }: { rows: PickRow[] }) {
    return (
        <Card padded={false} className="overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-black text-hackclub-dark">Pick list</h3>
                <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide">Everything the open queue needs, pulled in one pass</p>
            </div>
            {rows.length === 0 ? (
                <div className="py-10 text-center text-hackclub-muted font-bold">Nothing to pick. The queue is clear.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-hackclub-snow border-b-2 border-hackclub-smoke">
                            <tr className="text-left text-hackclub-muted font-black uppercase text-xs">
                                <th className="px-4 py-3">Item</th>
                                <th className="px-4 py-3 text-right">Pull</th>
                                <th className="px-4 py-3 text-right">Orders</th>
                                <th className="px-4 py-3 text-right">On hand</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const short = r.onHand !== null && r.onHand < r.quantity;
                                return (
                                    <tr key={r.variantId || r.name} className="border-b border-hackclub-smoke last:border-0">
                                        <td className="px-4 py-3 font-bold text-hackclub-dark">{r.name}</td>
                                        <td className="px-4 py-3 text-right font-mono font-bold">{r.quantity}</td>
                                        <td className="px-4 py-3 text-right font-mono text-hackclub-slate">{r.orders}</td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${short ? 'text-hackclub-red' : 'text-hackclub-dark'}`}>
                                            {r.onHand === null ? <span className="text-hackclub-muted font-normal">untracked</span> : r.onHand}
                                            {short && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-black bg-hackclub-red/10 text-hackclub-red">short {r.quantity - (r.onHand ?? 0)}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}

// ── Ship queue ────────────────────────────────────────────────────────────────
function QueueCard({ queue, shipFrom }: { queue: QueueOrder[]; shipFrom: ShipFrom }) {
    return (
        <Card padded={false} className="overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-black text-hackclub-dark">Ship queue</h3>
                <p className="text-xs text-hackclub-muted font-bold uppercase tracking-wide">Paid orders waiting on a label, oldest first</p>
            </div>
            {queue.length === 0 ? (
                <div className="p-5"><EmptyState message="Nothing waiting to ship." /></div>
            ) : (
                <div className="divide-y divide-hackclub-smoke">
                    {queue.map((o) => {
                        const age = ageDays(o.createdAt);
                        return (
                            <div key={o.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-hackclub-dark flex items-center gap-2 flex-wrap">
                                        #{o.id.slice(-8)}
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${o.pathway === 'guest' ? 'bg-purple-100 text-purple-800' : 'bg-cyan-100 text-cyan-800'}`}>
                                            {o.pathway === 'guest' ? 'Card' : 'Points'}
                                        </span>
                                        {o.vestNumber !== null && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-black bg-hackclub-dark text-white">Vest #{o.vestNumber}</span>
                                        )}
                                        <span className={`text-xs font-bold ${age >= 5 ? 'text-hackclub-red' : age >= 2 ? 'text-hackclub-orange' : 'text-hackclub-muted'}`}>
                                            {age === 0 ? 'today' : `${age}d old`}
                                        </span>
                                    </p>
                                    <p className="text-sm text-hackclub-slate truncate">
                                        {o.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                                    </p>
                                    <p className="text-xs text-hackclub-muted">
                                        {o.shippingAddress
                                            ? `To ${o.shippingAddress.name}, ${o.shippingAddress.city}, ${o.shippingAddress.state} ${o.shippingAddress.postal_code}`
                                            : 'No shipping address on the order'}
                                        {o.paidShipping && (
                                            <span className="ml-2 font-bold text-hackclub-blue">
                                                Paid for {`${o.paidShipping.carrier} ${o.paidShipping.service}`.trim()}
                                                {o.paidShipping.cost !== null ? ` ($${o.paidShipping.cost.toFixed(2)})` : ''}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => printPackingSlips([o], shipFrom)}
                                        className="px-4 py-2 rounded-lg text-sm font-bold border-2 border-hackclub-smoke hover:border-hackclub-slate text-hackclub-slate transition-colors"
                                    >
                                        Packing slip
                                    </button>
                                    <Link
                                        href="/admin/orders"
                                        className="px-4 py-2 rounded-lg text-sm font-bold bg-hackclub-blue hover:bg-blue-600 text-white transition-colors"
                                    >
                                        Buy label
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ── Packing slips ─────────────────────────────────────────────────────────────
/**
 * Open a print window with one slip per order. Self-contained HTML (no app CSS)
 * so it prints clean on the warehouse printer; one slip per page.
 */
function printPackingSlips(orders: QueueOrder[], shipFrom: ShipFrom) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fromLines = [
        shipFrom.company || shipFrom.name,
        shipFrom.street1, shipFrom.street2,
        [shipFrom.city, shipFrom.state, shipFrom.zip].filter(Boolean).join(', '),
    ].filter(Boolean) as string[];

    const slips = orders.map((o) => {
        const to = o.shippingAddress;
        const toLines = to
            ? [to.name, to.line1, to.line2, `${to.city}, ${to.state} ${to.postal_code}`, to.country !== 'US' ? to.country : null].filter(Boolean) as string[]
            : ['No shipping address on file'];
        return `
        <section class="slip">
            <header>
                <h1>Hack Club Shop</h1>
                <p class="order">Order #${esc(o.id.slice(-8))} · ${new Date(o.createdAt).toLocaleDateString()}</p>
            </header>
            <div class="addresses">
                <div><h2>Ship to</h2>${toLines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
                <div><h2>From</h2>${fromLines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
            </div>
            ${o.paidShipping ? `<p class="ship-level">Ship via: <strong>${esc(`${o.paidShipping.carrier} ${o.paidShipping.service}`.trim())}</strong> (paid at checkout)</p>` : ''}
            <table>
                <thead><tr><th>Qty</th><th>Item</th></tr></thead>
                <tbody>
                    ${o.items.map((i) => `<tr><td class="qty">${i.quantity}</td><td>${esc(i.name)}</td></tr>`).join('')}
                </tbody>
            </table>
            ${o.vestNumber !== null ? `<p class="vest">Numbered vest: include vest #${o.vestNumber}. Check the number before packing.</p>` : ''}
            <footer>Thanks for supporting teenage makers. shop.hackclub.com</footer>
        </section>`;
    }).join('');

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Packing slips</title><style>
        * { box-sizing: border-box; margin: 0; }
        body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #1f2d3d; }
        .slip { padding: 32px; page-break-after: always; max-width: 640px; margin: 0 auto; }
        header { border-bottom: 3px solid #ec3750; padding-bottom: 12px; margin-bottom: 20px; }
        h1 { font-size: 20px; }
        .order { color: #8492a6; font-weight: bold; margin-top: 4px; }
        .addresses { display: flex; gap: 48px; margin-bottom: 20px; }
        h2 { font-size: 11px; text-transform: uppercase; color: #8492a6; letter-spacing: 0.05em; margin-bottom: 6px; }
        .addresses p { font-size: 14px; line-height: 1.5; }
        .ship-level { font-size: 13px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; color: #8492a6; border-bottom: 2px solid #e0e6ed; padding: 6px 8px; }
        td { padding: 8px; border-bottom: 1px solid #e0e6ed; font-size: 14px; }
        .qty { width: 48px; font-weight: bold; }
        .vest { font-size: 13px; font-weight: bold; background: #fdf1f3; border: 1px solid #ec3750; border-radius: 6px; padding: 10px; margin-bottom: 16px; }
        footer { font-size: 12px; color: #8492a6; }
    </style></head><body>${slips}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
}
