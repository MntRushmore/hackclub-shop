/**
 * Transactional email layer for the shop.
 *
 * Provider-agnostic by design: the templates and send-triggers are built now,
 * but nothing is actually delivered until an email provider is configured via
 * env. Until then every send is a safe no-op (logged, never thrown) — exactly
 * like the Airtable mirror — so order flows are never blocked by email.
 *
 * To go live, set EMAIL_PROVIDER + the matching key (see sendViaProvider) and a
 * EMAIL_FROM address. The wiring in the webhook / orders routes does not change.
 */

import { Order } from '../types/Order';
import { formatAddress } from './address';
import { unsubscribeUrl } from './emailSuppression';

const FROM = process.env.EMAIL_FROM || 'Hack Club Shop <shop@hackclub.com>';
// Where customer replies should land. The From address (orders@…) is a sending
// identity that isn't actively monitored, so point replies at the support inbox.
// Falls back to the public support address so replies are never dropped.
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'shop@hackclub.com';
const ADMIN_EMAIL = process.env.ADMIN_ORDER_EMAIL; // staff inbox for new-order alerts
// Public base URL for links in emails (no request context here). Falls back
// through the URLs already configured for the app.
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXTAUTH_URL || 'https://shop.hackclub.com').replace(/\/$/, '');

// Brand.
const RED = '#ec3750';
const INK = '#17171d';
const MUTED = '#8492a6';
const LINE = '#e9e4dc';
// Phantom Sans is Hack Club's typeface. Email clients won't load a webfont
// reliably, so we (a) declare a @font-face pointing at the hosted woff — honored
// by Apple Mail / iOS Mail / some webmail — and (b) name it first in the stack
// with a clean system fallback for everyone else (Gmail/Outlook).
const FONT = "'Phantom Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// The real "Hack Club Shop" wordmark (white variant, for the dark header strip;
// ~3.06:1 aspect ratio). Pinned to the production host on purpose: email clients
// need an always-resolvable absolute URL, and BASE_URL can be localhost in dev,
// which would leave a broken image in any test send.
const WORDMARK_WHITE = 'https://shop.hackclub.com/images/hack-club-shop-wordmark-white.png';

/** @font-face for Phantom Sans, inlined into each email's <style>. */
const FONT_FACE = `<style>
@font-face{font-family:'Phantom Sans';font-style:normal;font-weight:400;src:url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Regular.woff2') format('woff2'),url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Regular.woff') format('woff');}
@font-face{font-family:'Phantom Sans';font-style:normal;font-weight:700;src:url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Bold.woff2') format('woff2'),url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Bold.woff') format('woff');}
</style>`;

export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
    /**
     * RFC 8058 one-click unsubscribe headers. Present on recipient-facing mail
     * (not admin alerts); the provider layer maps them to real SMTP headers so
     * Gmail/Apple Mail render a native unsubscribe button.
     */
    listUnsubscribe?: string;
    listUnsubscribePost?: string;
}

/** True once an email provider is configured. Until then sends are no-ops. */
export function isEmailConfigured(): boolean {
    const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
    if (provider === 'resend') return Boolean(process.env.RESEND_API_KEY);
    if (provider === 'postmark') return Boolean(process.env.POSTMARK_TOKEN);
    return false;
}

/**
 * Deliver one email. Returns true if sent, false if skipped/failed. Never throws
 * — callers `void sendEmail(...)` and must not depend on the result.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
    if (!isEmailConfigured()) {
        // Don't log the recipient address (PII); the subject is enough to debug.
        console.log(`[email] skipped (no provider configured): "${msg.subject}"`);
        return false;
    }
    try {
        await sendViaProvider(msg);
        return true;
    } catch (err) {
        console.error('[email] send failed:', err instanceof Error ? err.message : err);
        return false;
    }
}

/**
 * The only provider-specific code. Add a branch per provider. Kept tiny and
 * dependency-free (uses fetch) so no SDK is required to swap providers later.
 */
async function sendViaProvider(msg: EmailMessage): Promise<void> {
    const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();

    if (provider === 'resend') {
        // Resend takes List-Unsubscribe via a `headers` map. Including both the
        // header and List-Unsubscribe-Post unlocks Gmail/Apple one-click unsub.
        const unsubHeaders: Record<string, string> = {};
        if (msg.listUnsubscribe) unsubHeaders['List-Unsubscribe'] = msg.listUnsubscribe;
        if (msg.listUnsubscribePost) unsubHeaders['List-Unsubscribe-Post'] = msg.listUnsubscribePost;

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM,
                to: msg.to,
                reply_to: REPLY_TO,
                subject: msg.subject,
                html: msg.html,
                text: msg.text,
                ...(Object.keys(unsubHeaders).length ? { headers: unsubHeaders } : {}),
            }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
    }

    if (provider === 'postmark') {
        const pmHeaders: { Name: string; Value: string }[] = [];
        if (msg.listUnsubscribe) pmHeaders.push({ Name: 'List-Unsubscribe', Value: msg.listUnsubscribe });
        if (msg.listUnsubscribePost) pmHeaders.push({ Name: 'List-Unsubscribe-Post', Value: msg.listUnsubscribePost });

        const res = await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN || '',
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                From: FROM,
                To: msg.to,
                ReplyTo: REPLY_TO,
                Subject: msg.subject,
                HtmlBody: msg.html,
                TextBody: msg.text,
                ...(pmHeaders.length ? { Headers: pmHeaders } : {}),
            }),
        });
        if (!res.ok) throw new Error(`Postmark ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
    }

    throw new Error(`Unknown EMAIL_PROVIDER: "${provider}"`);
}

// ── Templates ─────────────────────────────────────────────────────────────────

function itemsText(order: Order): string {
    return order.items.map(i => `  • ${i.quantity}× ${i.name}`).join('\n');
}
/** Branded line-item rows: thumbnail (when present) + qty badge + name. */
function itemsHtml(order: Order): string {
    return order.items
        .map(i => {
            const thumb = i.thumbnail_url
                ? `<td width="48" style="padding:0 14px 0 0;vertical-align:middle">
                       <img src="${escapeHtml(i.thumbnail_url)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;object-fit:cover;border:1px solid ${LINE}"/>
                   </td>`
                : '';
            return `<tr>
                ${thumb}
                <td style="padding:11px 0;vertical-align:middle;font-size:15px;color:${INK};border-bottom:1px solid ${LINE}">
                    <span style="display:inline-block;min-width:24px;text-align:center;background:${RED};color:#fff;font-weight:700;padding:2px 6px;margin-right:10px;font-size:12px">${i.quantity}&times;</span>
                    ${escapeHtml(i.name)}
                </td>
            </tr>`;
        })
        .join('');
}
function priceLine(order: Order): string {
    if (order.pathway !== 'guest') {
        return `Total: ${order.pointsSpent} points`;
    }
    // When Stripe Tax was applied, totalAmount is tax-INCLUSIVE — show the
    // breakdown so the customer can see items, shipping, and tax separately
    // (otherwise the total looks higher than the items with no explanation).
    const usd = (n: number) => `$${n.toFixed(2)}`;
    if (order.taxAmount && order.taxAmount > 0) {
        const parts = [`Subtotal: ${usd(order.subtotal)}`];
        if (order.shippingCost > 0) parts.push(`Shipping: ${usd(order.shippingCost)}`);
        parts.push(`Tax: ${usd(order.taxAmount)}`);
        parts.push(`Total: ${usd(order.totalAmount)}`);
        return parts.join('\n');
    }
    return `Total: ${usd(order.totalAmount)}`;
}
/** HTML form of priceLine: escape, then render the multi-line breakdown with <br>. */
function priceLineHtml(order: Order): string {
    return escapeHtml(priceLine(order)).replace(/\n/g, '<br>');
}
function shippingLine(order: Order): string {
    return order.shippingAddress ? formatAddress(order.shippingAddress) : (order.shippingCountry || '');
}

interface ShellOpts {
    /** Small eyebrow label above the title, e.g. "Order confirmed". */
    eyebrow?: string;
    /** Recipient address — when set, the footer carries a personal unsubscribe link. */
    unsubscribeFor?: string;
    /** Short preheader text shown in the inbox preview line. */
    preview?: string;
}

/**
 * Branded HTML shell. Table-based and inline-styled for email-client
 * compatibility (Gmail/Outlook strip <style> and flexbox). The Hack Club Shop
 * wordmark sits on a dark ink header over a red rule; the body is a flat white
 * panel with sharp corners throughout — no rounded shapes, no gradients.
 * Recipient mail gets an unsubscribe line in the footer.
 */
function shell(title: string, bodyHtml: string, opts: ShellOpts = {}): string {
    const preheader = opts.preview
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preview)}</div>`
        : '';
    const eyebrow = opts.eyebrow
        ? `<p style="margin:0 0 10px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${RED};font-weight:700">${escapeHtml(opts.eyebrow)}</p>`
        : '';

    const unsub = opts.unsubscribeFor
        ? `<p style="margin:12px 0 0;color:${MUTED};font-size:12px;line-height:1.7">
               You're getting this because you placed an order at the Hack Club Shop.
               Receipts &amp; shipping updates always send.<br/>
               <a href="${escapeHtml(unsubscribeUrl(BASE_URL, opts.unsubscribeFor))}" style="color:${MUTED};text-decoration:underline">Unsubscribe from other emails</a>
           </p>`
        : '';

    return `<!-- branded -->${FONT_FACE}
    ${preheader}
    <div style="margin:0;padding:0;background:#f4f1ec">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec">
        <tr><td align="center" style="padding:32px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;font-family:${FONT};color:${INK};border:1px solid ${LINE}">

            <!-- Wordmark header on ink -->
            <tr><td style="background:${INK};padding:24px 30px">
              <img src="${WORDMARK_WHITE}" alt="Hack Club Shop" width="176" height="58" style="display:block;width:176px;height:auto;border:0"/>
            </td></tr>
            <!-- Red rule -->
            <tr><td style="background:${RED};font-size:0;line-height:0;height:5px">&nbsp;</td></tr>

            <!-- Content panel -->
            <tr><td style="background:#ffffff;padding:34px 30px 30px">
              ${eyebrow}
              <h1 style="margin:0 0 18px;color:${INK};font-size:25px;line-height:1.2;font-weight:700;letter-spacing:-.01em">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </td></tr>

            <!-- Footer -->
            <tr><td style="background:#ffffff;border-top:1px solid ${LINE};padding:22px 30px 26px">
              <p style="margin:0;color:${INK};font-size:13px;font-weight:700">Hack Club Shop</p>
              <p style="margin:5px 0 0;color:${MUTED};font-size:12px;line-height:1.6">Questions? Just reply to this email or write <a href="mailto:shop@hackclub.com" style="color:${RED};text-decoration:underline">shop@hackclub.com</a>.</p>
              <p style="margin:5px 0 0;color:#b3bdca;font-size:12px;line-height:1.6">8605 Santa Monica Blvd #86294, West Hollywood, CA 90069</p>
              ${unsub}
            </td></tr>

          </table>
        </td></tr>
      </table>
    </div>`;
}

/** Primary call-to-action button — flat, sharp-cornered, brand red. */
function button(href: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px">
        <tr><td style="background:${RED}">
            <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a>
        </td></tr>
    </table>`;
}

/** A flat summary panel used for the price total + shipping address. */
function summaryBox(inner: string): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;background:#faf8f4;border:1px solid ${LINE};border-left:3px solid ${RED}">
        <tr><td style="padding:16px 18px">${inner}</td></tr>
    </table>`;
}

/** Order confirmation to the customer (works for both guest + student orders). */
export function buildOrderConfirmation(order: Order, to: string): EmailMessage {
    const ref = order.id.slice(-8);

    // Guests have no account; give them a self-serve status link prefilled with
    // their email + order ref. Students track orders from /orders while signed in.
    const trackUrl =
        order.pathway === 'guest'
            ? `${BASE_URL}/orders/track?email=${encodeURIComponent(to)}&ref=${encodeURIComponent(ref)}`
            : `${BASE_URL}/orders`;
    const trackText = `\n\nTrack your order: ${trackUrl}`;

    const text = `Thanks for your order!\n\nOrder #${ref}\n\nItems:\n${itemsText(order)}\n\n${priceLine(order)}\nShipping to: ${shippingLine(order)}\n\nWe'll let you know when it ships.${trackText}`;
    const html = shell('Thanks for your order!', `
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:${INK}">Your order <strong style="color:${RED}">#${ref}</strong> is confirmed. We're on it — you'll get another email the moment it ships.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-top:1px solid ${LINE}">
            ${itemsHtml(order)}
        </table>
        ${summaryBox(`
            <p style="margin:0;font-size:16px;font-weight:700;color:${INK}">${priceLineHtml(order)}</p>
            <p style="margin:10px 0 0;color:${MUTED};font-size:13px;line-height:1.5">Shipping to<br><span style="color:${INK}">${escapeHtml(shippingLine(order))}</span></p>
        `)}
        ${button(trackUrl, 'Track your order →')}`, {
        eyebrow: 'Order confirmed',
        unsubscribeFor: to,
        preview: `Order #${ref} confirmed — we'll email you when it ships.`,
    });
    return withUnsubscribe({ to, subject: `Your Hack Club Shop order #${ref}`, html, text });
}

/** Alert to the staff inbox when a new order arrives. */
export function buildAdminNewOrder(order: Order): EmailMessage | null {
    if (!ADMIN_EMAIL) return null;
    const ref = order.id.slice(-8);
    const who = order.pathway === 'guest' ? (order.guestEmail || 'guest') : order.userId;
    const text = `New ${order.pathway} order #${ref} from ${who}\n\nItems:\n${itemsText(order)}\n\n${priceLine(order)}\nShipping to: ${shippingLine(order)}\n\nManage it in the admin dashboard.`;
    const html = shell('New order just came in', `
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:${INK}"><strong style="color:${RED}">#${ref}</strong> — ${escapeHtml(order.pathway)} order from <strong>${escapeHtml(who)}</strong></p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-top:1px solid ${LINE}">
            ${itemsHtml(order)}
        </table>
        ${summaryBox(`
            <p style="margin:0;font-size:16px;font-weight:700;color:${INK}">${priceLineHtml(order)}</p>
            <p style="margin:10px 0 0;color:${MUTED};font-size:13px;line-height:1.5">Shipping to<br><span style="color:${INK}">${escapeHtml(shippingLine(order))}</span></p>
        `)}
        ${button(`${BASE_URL}/admin/orders`, 'Open in admin →')}`, {
        eyebrow: `${order.pathway} order`,
        preview: `New ${order.pathway} order #${ref}`,
    });
    return { to: ADMIN_EMAIL, subject: `New ${order.pathway} order #${ref}`, html, text };
}

/** Status-change email to the customer (received / fulfilled / delivered / refunded). */
export function buildStatusUpdate(order: Order, to: string, message?: string): EmailMessage {
    const ref = order.id.slice(-8);
    const map: Record<string, string> = {
        received: 'We received your order and are getting it ready.',
        fulfilled: 'Your order has shipped!',
        delivered: 'Your order was delivered. Enjoy!',
        refunded: 'Your order has been refunded.',
    };
    const line = map[order.status] || `Your order status is now: ${order.status}.`;
    const reason = message ? `\n\nNote: ${message}` : '';

    // When the order shipped with a tracking number, surface it prominently.
    const ship = order.status === 'fulfilled' ? order.shipment : undefined;
    const carrierLabel = ship?.carrier ? `${ship.carrier}${ship.service ? ` ${ship.service}` : ''}` : '';
    const eta = ship?.estDeliveryDate ? `\nEstimated delivery: ${ship.estDeliveryDate}` : '';
    const trackText = ship?.trackingNumber
        ? `\n\nTracking${carrierLabel ? ` (${carrierLabel})` : ''}: ${ship.trackingNumber}${ship.trackingUrl ? `\n${ship.trackingUrl}` : ''}${eta}`
        : '';

    const text = `Order #${ref}\n\n${line}${reason}${trackText}`;
    const trackHtml = ship?.trackingNumber
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;background:#faf8f4;border:1px solid ${LINE};border-left:3px solid ${RED}">
            <tr><td style="padding:16px 18px">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};font-weight:700">Tracking${carrierLabel ? ` · ${escapeHtml(carrierLabel)}` : ''}</p>
              <p style="margin:0 0 12px;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;color:${INK};letter-spacing:.02em">${escapeHtml(ship.trackingNumber)}</p>
              ${ship.trackingUrl ? button(ship.trackingUrl, 'Track your package →') : ''}
              ${ship.estDeliveryDate ? `<p style="margin:12px 0 0;color:${MUTED};font-size:13px">Estimated delivery: <strong style="color:${INK}">${escapeHtml(ship.estDeliveryDate)}</strong></p>` : ''}
            </td></tr>
        </table>`
        : '';
    const eyebrowMap: Record<string, string> = {
        received: 'Order received',
        fulfilled: 'On its way',
        delivered: 'Delivered',
        refunded: 'Refund issued',
    };
    const titleMap: Record<string, string> = {
        received: 'We got your order',
        fulfilled: 'Your order has shipped',
        delivered: 'Your order was delivered',
        refunded: 'Your order was refunded',
    };
    const html = shell(titleMap[order.status] || `Order #${ref} update`, `
        <p style="margin:0;font-size:15px;line-height:1.6;color:${INK}">${escapeHtml(line)}</p>
        ${message ? `<p style="margin:14px 0 0;padding:12px 16px;background:#faf8f4;border-left:3px solid ${RED};color:${INK};font-size:14px;line-height:1.55">${escapeHtml(message)}</p>` : ''}
        ${trackHtml}`, {
        eyebrow: eyebrowMap[order.status] || `Order #${ref}`,
        unsubscribeFor: to,
        preview: line,
    });
    return withUnsubscribe({ to, subject: `Update on your order #${ref}`, html, text });
}

/**
 * Attach the one-click unsubscribe headers (RFC 8058) for a recipient-facing
 * message. The mailto + https targets both point at our unsubscribe handler so
 * Gmail/Apple render a native "Unsubscribe" button.
 */
function withUnsubscribe(msg: EmailMessage): EmailMessage {
    const url = unsubscribeUrl(BASE_URL, msg.to);
    return {
        ...msg,
        listUnsubscribe: `<${url}>`,
        listUnsubscribePost: 'List-Unsubscribe=One-Click',
    };
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
