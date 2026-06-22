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

const FROM = process.env.EMAIL_FROM || 'Hack Club Shop <shop@hackclub.com>';
const ADMIN_EMAIL = process.env.ADMIN_ORDER_EMAIL; // staff inbox for new-order alerts

export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
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
        console.log(`[email] skipped (no provider configured): "${msg.subject}" -> ${msg.to}`);
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
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
    }

    if (provider === 'postmark') {
        const res = await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN || '',
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ From: FROM, To: msg.to, Subject: msg.subject, HtmlBody: msg.html, TextBody: msg.text }),
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
function itemsHtml(order: Order): string {
    return order.items.map(i => `<li>${i.quantity}× ${escapeHtml(i.name)}</li>`).join('');
}
function priceLine(order: Order): string {
    return order.pathway === 'guest'
        ? `Total: $${order.totalAmount.toFixed(2)}`
        : `Total: ${order.pointsSpent} points`;
}
function shippingLine(order: Order): string {
    return order.shippingAddress ? formatAddress(order.shippingAddress) : (order.shippingCountry || '');
}

function shell(title: string, bodyHtml: string): string {
    return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1f2d3d">
        <h1 style="color:#ec3750">${escapeHtml(title)}</h1>
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e0e6ed;margin:24px 0"/>
        <p style="color:#8492a6;font-size:13px">Hack Club Shop</p>
    </div>`;
}

/** Order confirmation to the customer (works for both guest + student orders). */
export function buildOrderConfirmation(order: Order, to: string): EmailMessage {
    const ref = order.id.slice(-8);
    const text = `Thanks for your order!\n\nOrder #${ref}\n\nItems:\n${itemsText(order)}\n\n${priceLine(order)}\nShipping to: ${shippingLine(order)}\n\nWe'll let you know when it ships.`;
    const html = shell('Thanks for your order!', `
        <p>Your order <strong>#${ref}</strong> is confirmed.</p>
        <ul>${itemsHtml(order)}</ul>
        <p><strong>${escapeHtml(priceLine(order))}</strong></p>
        <p style="color:#8492a6">Shipping to: ${escapeHtml(shippingLine(order))}</p>
        <p>We'll email you again when it ships.</p>`);
    return { to, subject: `Your Hack Club Shop order #${ref}`, html, text };
}

/** Alert to the staff inbox when a new order arrives. */
export function buildAdminNewOrder(order: Order): EmailMessage | null {
    if (!ADMIN_EMAIL) return null;
    const ref = order.id.slice(-8);
    const who = order.pathway === 'guest' ? (order.guestEmail || 'guest') : order.userId;
    const text = `New ${order.pathway} order #${ref} from ${who}\n\nItems:\n${itemsText(order)}\n\n${priceLine(order)}\nShipping to: ${shippingLine(order)}\n\nManage it in the admin dashboard.`;
    const html = shell('New order', `
        <p><strong>#${ref}</strong> — ${escapeHtml(order.pathway)} order from ${escapeHtml(who)}</p>
        <ul>${itemsHtml(order)}</ul>
        <p><strong>${escapeHtml(priceLine(order))}</strong></p>
        <p style="color:#8492a6">Shipping to: ${escapeHtml(shippingLine(order))}</p>
        <p>Manage it in the admin dashboard.</p>`);
    return { to: ADMIN_EMAIL, subject: `New ${order.pathway} order #${ref}`, html, text };
}

/** Status-change email to the customer (approved / denied / fulfilled / refunded). */
export function buildStatusUpdate(order: Order, to: string, message?: string): EmailMessage {
    const ref = order.id.slice(-8);
    const map: Record<string, string> = {
        approved: 'Your order has been approved and is being prepared.',
        fulfilled: 'Your order has shipped!',
        denied: 'Your order was denied.',
        refunded: 'Your order has been refunded.',
    };
    const line = map[order.status] || `Your order status is now: ${order.status}.`;
    const reason = message ? `\n\nNote: ${message}` : '';
    const text = `Order #${ref}\n\n${line}${reason}`;
    const html = shell(`Order #${ref} update`, `
        <p>${escapeHtml(line)}</p>
        ${message ? `<p style="color:#8492a6">Note: ${escapeHtml(message)}</p>` : ''}`);
    return { to, subject: `Update on your order #${ref}`, html, text };
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
