import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { mirrorOrder, mirrorUser } from '../../../../lib/airtableMirror';
import { getGuestOrder, updateGuestOrder } from '../../../../lib/guestOrders';

/** Mirror the single order matching orderId out of an updated orders array (best-effort). */
function mirrorUpdatedOrder(updatedOrders: any[], orderId: string, userId: string) {
    const updated = (updatedOrders || []).find((o: any) => o.id === orderId);
    if (updated) void mirrorOrder({ ...updated, userId }, undefined);
}

/** Best-effort Slack post (chat.postMessage) used for staff notes and customer DMs. */
async function postSlackMessage(channel: string, text: string) {
    try {
        await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ channel, text }),
        });
    } catch {
    }
}

/**
 * Refund an order's POINTS back to the student's points balance and record a
 * points refund transaction. Reads `pointsSpent` from the order itself — never
 * a dollar amount parsed from Slack text. Returns the new points balance, or
 * null if nothing was refunded.
 */
async function refundStudentPoints(
    redis: any,
    userId: string,
    orderId: string,
    pointsSpent: number,
): Promise<number | null> {
    if (!userId || !(pointsSpent > 0)) return null;

    const currentPoints = ((await redis.get(`user:${userId}:pointsBalance`)) as number) || 0;
    const currentTransactions = ((await redis.get(`user:${userId}:pointsTransactions`)) as any[]) || [];

    const refundTransaction = {
        id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        amount: pointsSpent,
        type: 'refund',
        description: `Order #${orderId.slice(-8)} refunded`,
        timestamp: new Date(),
        orderId,
    };

    const newPointsBalance = currentPoints + pointsSpent;
    await redis.set(`user:${userId}:pointsBalance`, newPointsBalance);
    await redis.set(`user:${userId}:pointsTransactions`, [refundTransaction, ...currentTransactions]);
    void mirrorUser({ userId, pointsBalance: newPointsBalance });

    return newPointsBalance;
}

/** Staff-facing note telling them to refund a card (Stripe) order manually. */
function manualStripeRefundNote(order: any): string {
    const amount = typeof order?.totalAmount === 'number' ? order.totalAmount.toFixed(2) : '0.00';
    const pi = order?.stripePaymentIntentId ? ` (payment ${order.stripePaymentIntentId})` : '';
    return `⚠️ This is a CARD order ($${amount}). Refund it manually in the Stripe dashboard${pi}.`;
}

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

function verifySlackRequest(request: NextRequest, body: string): boolean {
    if (!SLACK_SIGNING_SECRET) {
        return true;
    }

    const timestamp = request.headers.get('x-slack-request-timestamp');
    const signature = request.headers.get('x-slack-signature');

    if (!timestamp || !signature) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
        return false;
    }

    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
    hmac.update(baseString);
    const computedSignature = `v0=${hmac.digest('hex')}`;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature));
}

export async function POST(request: NextRequest) {
    const bodyText = await request.text();

    if (!verifySlackRequest(request, bodyText)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const params = new URLSearchParams(bodyText);
        const payloadString = params.get('payload');
        
        if (!payloadString) {
            return NextResponse.json({ error: 'No payload' }, { status: 400 });
        }

        const payload = JSON.parse(payloadString);

        if (payload.type === 'url_verification') {
            return NextResponse.json({ challenge: payload.challenge });
        }

        if (payload.type === 'view_submission') {
            const callbackId = payload.view.callback_id;
            const values = payload.view.state.values;
            const privateMetadata = payload.view.private_metadata ? JSON.parse(payload.view.private_metadata) : {};
            
            if (callbackId.startsWith('custom_msg_modal_')) {
                const orderId = privateMetadata.orderId;
                const messageTs = privateMetadata.messageTs;
                const channelId = privateMetadata.channelId;
                const messageText = values.message_input?.message_text?.value || '';
                
                
                if (messageText) {
                    try {
                        const { Redis } = await import('@upstash/redis');
                        const redis = new Redis({
                            url: process.env.UPSTASH_REDIS_REST_URL!,
                            token: process.env.UPSTASH_REDIS_REST_TOKEN!,
                        });
                        
                        const userKeys = await redis.keys('user:*:orders');
                        for (const key of userKeys) {
                            const orders = await redis.get<any[]>(key);
                            if (orders && orders.some((o: any) => o.id === orderId)) {
                                const userId = key.split(':')[1];
                                const updatedOrders = orders.map((o: any) => {
                                    if (o.id === orderId) {
                                        return {
                                            ...o,
                                            statusHistory: [...(o.statusHistory || []), { status: 'approved', timestamp: new Date(), message: `Staff message: ${messageText}` }]
                                        };
                                    }
                                    return o;
                                });
                                await redis.set(`user:${userId}:orders`, updatedOrders);
                                mirrorUpdatedOrder(updatedOrders, orderId, userId);
                                break;
                            }
                        }
                    } catch {
                    }
                    
                    
                    if (messageTs && channelId) {
                        try {
                            const existingRes = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&limit=1&inclusive=true`, {
                                headers: {
                                    'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                },
                            });
                            
                            const historyData = await existingRes.json();
                            const messages = historyData.messages || [];
                            const messageBlock = messages[0];
                            
                            if (messageBlock && messageBlock.blocks) {
                                const fieldsBlock = messageBlock.blocks.find((b: any) => b.fields && b.fields.length > 0);
                                const customerField = fieldsBlock?.fields?.find((f: any) => f.text?.includes('*Customer:*'));
                                const customerText = customerField?.text || '';
                                const slackMatch = customerText.match(/<@([A-Z0-9]+)>/);
                                const customerSlackId = slackMatch?.[1];
                                
                                if (customerSlackId) {
                                    try {
                                        await fetch('https://slack.com/api/chat.postMessage', {
                                            method: 'POST',
                                            headers: {
                                                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                                'Content-Type': 'application/json; charset=utf-8',
                                            },
                                            body: JSON.stringify({
                                                channel: customerSlackId,
                                                text: `Message about your order #${orderId.slice(-8)}:\n\n${messageText}`,
                                            }),
                                        });
                                    } catch {
                                    }
                                }
                                const updatedBlocks = messageBlock.blocks.map((block: any) => {
                                    if (block.type === 'section' && block.text?.text?.includes('Status:')) {
                                        return {
                                            type: 'section',
                                            text: {
                                                type: 'mrkdwn',
                                                text: `📋 *Status:* ✅ Message sent to customer\n> ${messageText}`,
                                            },
                                        };
                                    }
                                    return block;
                                });
                                
                                await fetch('https://slack.com/api/chat.update', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                        'Content-Type': 'application/json; charset=utf-8',
                                    },
                                    body: JSON.stringify({
                                        channel: channelId,
                                        ts: messageTs,
                                        blocks: updatedBlocks,
                                    }),
                                });
                            }
                        } catch {
                        }
                    }
                }
                
                return NextResponse.json({});
            }
            
            if (callbackId.startsWith('deny_order_modal')) {
                const orderId = privateMetadata.orderId;
                const messageTs = privateMetadata.messageTs;
                const channelId = privateMetadata.channelId;
                const denialReason = values.reason_input?.reason_text?.value || '';
                
                
                try {
                    const existingRes = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&limit=1&inclusive=true`, {
                        headers: {
                            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        },
                    });
                    
                    const historyData = await existingRes.json();
                    const messages = historyData.messages || [];
                    const messageBlock = messages[0];
                    
                    if (messageBlock && messageBlock.blocks) {
                        const fieldsBlock = messageBlock.blocks.find((b: any) => b.fields && b.fields.length > 0);
                        const customerField = fieldsBlock?.fields?.find((f: any) => f.text?.includes('*Customer:*'));
                        const customerText = customerField?.text || '';
                        const slackMatch = customerText.match(/<@([A-Z0-9]+)>/);
                        const slackId = slackMatch?.[1];

                        // Pathway-aware refund + status update on deny.
                        // - Student (points): return pointsSpent to the user's points balance.
                        // - Guest (Stripe): never auto-refund; post a manual-refund note for staff.
                        // We default to the safe (manual-refund) branch if we cannot determine pathway.
                        let denyConfirmationText = `❌ Your order #${orderId.slice(-8)} has been denied.\n\n*Reason:* ${denialReason}`;
                        try {
                            const { Redis } = await import('@upstash/redis');
                            const redis = new Redis({
                                url: process.env.UPSTASH_REDIS_REST_URL!,
                                token: process.env.UPSTASH_REDIS_REST_TOKEN!,
                            });

                            // Try to find the order as a student order first.
                            let studentUserId: string | null = null;
                            let studentOrder: any = null;
                            const userKeys = await redis.keys('user:*:orders');
                            for (const key of userKeys) {
                                const orders = await redis.get<any[]>(key);
                                const match = orders?.find((o: any) => o.id === orderId);
                                if (match) {
                                    studentUserId = key.split(':')[1];
                                    studentOrder = match;
                                    const updatedOrders = orders!.map((o: any) => {
                                        if (o.id === orderId) {
                                            return {
                                                ...o,
                                                status: 'denied',
                                                statusHistory: [...(o.statusHistory || []), { status: 'denied', timestamp: new Date(), message: denialReason }]
                                            };
                                        }
                                        return o;
                                    });
                                    await redis.set(`user:${studentUserId}:orders`, updatedOrders);
                                    mirrorUpdatedOrder(updatedOrders, orderId, studentUserId);
                                    break;
                                }
                            }

                            // Resolve userId from slackId if the order didn't carry one.
                            if (!studentUserId && slackId) {
                                const slackKeys = await redis.keys('user:*:slackId');
                                for (const key of slackKeys) {
                                    const stored_slackId = await redis.get<string>(key);
                                    if (stored_slackId === slackId) {
                                        studentUserId = key.split(':')[1];
                                        break;
                                    }
                                }
                            }

                            const guestOrder = await getGuestOrder(orderId);
                            const isGuest = (studentOrder?.pathway === 'guest')
                                || (guestOrder?.pathway === 'guest')
                                || (!studentOrder && !!guestOrder);

                            if (isGuest) {
                                // Card order: mark denied via the guest store; do NOT touch any balance.
                                const order = guestOrder || studentOrder;
                                try {
                                    const updated = await updateGuestOrder(orderId, {
                                        status: 'denied',
                                        statusHistory: [...((order?.statusHistory) || []), { status: 'denied', timestamp: new Date(), message: denialReason }],
                                    });
                                    if (updated) void mirrorOrder(updated as any, undefined);
                                } catch {
                                }
                                // Tell staff to refund manually in Stripe.
                                if (channelId) {
                                    await postSlackMessage(channelId, manualStripeRefundNote(order));
                                }
                            } else if (studentOrder || studentUserId) {
                                // Student order: refund POINTS from the order's pointsSpent.
                                const pointsSpent = Number(studentOrder?.pointsSpent) || 0;
                                if (studentUserId && pointsSpent > 0) {
                                    await refundStudentPoints(redis, studentUserId, orderId, pointsSpent);
                                    denyConfirmationText += `\n\n${pointsSpent} points have been returned to your account.`;
                                }
                            } else if (channelId) {
                                // Pathway unknown: safe default — post manual-refund note, never write a balance.
                                await postSlackMessage(channelId, manualStripeRefundNote({ totalAmount: 0 }));
                            }
                        } catch {
                        }

                        const updatedBlocks = messageBlock.blocks.map((block: any) => {
                            if (block.type === 'header') {
                                return {
                                    ...block,
                                    text: {
                                        ...block.text,
                                        text: '❌ Order Denied',
                                    },
                                };
                            }
                            if (block.type === 'section' && block.text?.text?.includes('Status:')) {
                                return {
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: `📋 *Status:* ❌ Denied\n> ${denialReason}`,
                                    },
                                };
                            }
                            return block;
                        });
                        
                        await fetch('https://slack.com/api/chat.update', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                'Content-Type': 'application/json; charset=utf-8',
                            },
                            body: JSON.stringify({
                                channel: channelId,
                                ts: messageTs,
                                blocks: updatedBlocks,
                            }),
                        });
                        
                        if (slackId) {
                            await postSlackMessage(slackId, denyConfirmationText);
                        }
                    }
                } catch {
                }
                
                return NextResponse.json({});
            }
            
            if (callbackId.startsWith('message_modal_')) {
                const messageTs = privateMetadata.messageTs;
                const channelId = privateMetadata.channelId;
                const messageText = values.message_input?.message_text?.value || '';
                
                
                if (messageText) {
                    const userId = payload.user.id;
                    try {
                        await fetch('https://slack.com/api/chat.postMessage', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                'Content-Type': 'application/json; charset=utf-8',
                            },
                            body: JSON.stringify({
                                channel: userId,
                                text: `Message about your donation:\n\n${messageText}`,
                            }),
                        });
                    } catch {
                    }
                    
                    if (messageTs && channelId) {
                        try {
                            const existingRes = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&limit=1&inclusive=true`, {
                                headers: {
                                    'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                },
                            });
                            
                            const historyData = await existingRes.json();
                            const messages = historyData.messages || [];
                            const messageBlock = messages[0];
                            
                            if (messageBlock && messageBlock.blocks) {
                                const updatedBlocks = messageBlock.blocks.map((block: any) => {
                                    if (block.type === 'section' && block.text?.text?.includes('Status:')) {
                                        return {
                                            type: 'section',
                                            text: {
                                                type: 'mrkdwn',
                                                text: `📋 *Status:* ✅ Message sent to donor\n> ${messageText}`,
                                            },
                                        };
                                    }
                                    return block;
                                });
                                
                                await fetch('https://slack.com/api/chat.update', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                        'Content-Type': 'application/json; charset=utf-8',
                                    },
                                    body: JSON.stringify({
                                        channel: channelId,
                                        ts: messageTs,
                                        blocks: updatedBlocks,
                                    }),
                                });
                            }
                        } catch {
                        }
                    }
                }
                
                return NextResponse.json({});
            }
        }

        if (payload.type === 'block_actions') {
            const action = payload.actions[0];
            const actionId = action.action_id;

            if (actionId.startsWith('approve_order_')) {
                const orderId = action.value;
                
                const originalBlocks = payload.message.blocks || [];
                const fieldsBlock = originalBlocks.find((b: any) => b.fields && b.fields.length > 0);
                const itemsBlock = originalBlocks.find((b: any) => b.text?.text?.includes('*Items:*'));
                
                try {
                    const { Redis } = await import('@upstash/redis');
                    const redis = new Redis({
                        url: process.env.UPSTASH_REDIS_REST_URL!,
                        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
                    });
                    
                    const userKeys = await redis.keys('user:*:orders');
                    for (const key of userKeys) {
                        const orders = await redis.get<any[]>(key);
                        if (orders && orders.some((o: any) => o.id === orderId)) {
                            const userId = key.split(':')[1];
                            const updatedOrders = orders.map((o: any) => {
                                if (o.id === orderId) {
                                    return {
                                        ...o,
                                        status: 'approved',
                                        statusHistory: [...(o.statusHistory || []), { status: 'approved', timestamp: new Date() }]
                                    };
                                }
                                return o;
                            });
                            await redis.set(`user:${userId}:orders`, updatedOrders);
                            mirrorUpdatedOrder(updatedOrders, orderId, userId);
                            break;
                        }
                    }
                } catch {
                }
                
                const updatedBlocks = [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '✅ Order Approved',
                        },
                    },
                    ...(fieldsBlock?.fields && fieldsBlock.fields.length > 0 ? [{
                        type: 'section',
                        fields: fieldsBlock.fields,
                    }] : []),
                    ...(itemsBlock ? [{
                        type: 'section',
                        text: itemsBlock.text,
                    }] : []),
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '📋 *Status:* ✅ Approved and ready for fulfillment',
                        },
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '💬 Custom Message',
                                },
                                value: orderId,
                                action_id: `custom_msg_${orderId}`,
                            },
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '✓ Mark Fulfilled',
                                },
                                value: orderId,
                                action_id: `fulfill_order_${orderId}`,
                                style: 'primary',
                            },
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '↩️ Refund',
                                },
                                value: orderId,
                                action_id: `refund_order_${orderId}`,
                                style: 'danger',
                            },
                        ],
                    },
                ];
                
                const channelId = payload.container?.channel_id || SLACK_CHANNEL_ID;
                
                await fetch('https://slack.com/api/chat.update', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        channel: channelId,
                        ts: payload.message.ts,
                        text: `✅ Order #${orderId.slice(-8)} approved`,
                        blocks: updatedBlocks,
                    }),
                });
                
                const customerBlock = originalBlocks.find((b: any) => 
                    b.fields?.some((f: any) => f.text?.includes('*Customer:*'))
                );
                const customerField = customerBlock?.fields?.find((f: any) => f.text?.includes('*Customer:*'));
                const customerText = customerField?.text || '';
                const slackMatch = customerText.match(/<@([A-Z0-9]+)>/);
                const slackId = slackMatch?.[1];
                
                if (slackId) {
                    try {
                        await fetch('https://slack.com/api/chat.postMessage', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                'Content-Type': 'application/json; charset=utf-8',
                            },
                            body: JSON.stringify({
                                channel: slackId,
                                text: `✅ Your order #${orderId.slice(-8)} has been approved and is being prepared for fulfillment!`,
                            }),
                        });
                    } catch {
                    }
                }

                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('deny_order_')) {
                const orderId = action.value;
                const messageTs = payload.message.ts;
                const channelId = payload.container.channel_id;
                
                const modalView = {
                    type: 'modal',
                    callback_id: 'deny_order_modal',
                    private_metadata: JSON.stringify({
                        orderId,
                        messageTs,
                        channelId,
                    }),
                    title: {
                        type: 'plain_text',
                        text: 'Deny Order',
                    },
                    submit: {
                        type: 'plain_text',
                        text: 'Deny & Refund',
                    },
                    blocks: [
                        {
                            type: 'input',
                            block_id: 'reason_input',
                            label: {
                                type: 'plain_text',
                                text: 'Denial reason',
                            },
                            element: {
                                type: 'plain_text_input',
                                action_id: 'reason_text',
                                multiline: true,
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Why is this order being denied?',
                                },
                            },
                        },
                    ],
                };
                
                await fetch('https://slack.com/api/views.open', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        trigger_id: payload.trigger_id,
                        view: modalView,
                    }),
                });
                
                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('fulfill_order_')) {
                const orderId = action.value;
                
                try {
                    const { Redis } = await import('@upstash/redis');
                    const redis = new Redis({
                        url: process.env.UPSTASH_REDIS_REST_URL!,
                        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
                    });
                    
                    const userKeys = await redis.keys('user:*:orders');
                    for (const key of userKeys) {
                        const orders = await redis.get<any[]>(key);
                        if (orders && orders.some((o: any) => o.id === orderId)) {
                            const userId = key.split(':')[1];
                            const updatedOrders = orders.map((o: any) => {
                                if (o.id === orderId) {
                                    return {
                                        ...o,
                                        status: 'fulfilled',
                                        statusHistory: [...(o.statusHistory || []), { status: 'fulfilled', timestamp: new Date() }]
                                    };
                                }
                                return o;
                            });
                            await redis.set(`user:${userId}:orders`, updatedOrders);
                            mirrorUpdatedOrder(updatedOrders, orderId, userId);
                            break;
                        }
                    }
                } catch {
                }
                
                const originalBlocks = payload.message.blocks || [];
                const fieldsBlock = originalBlocks.find((b: any) => b.fields && b.fields.length > 0);
                
                const updatedBlocks = [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '✅ Order Fulfilled',
                        },
                    },
                    ...(fieldsBlock?.fields && fieldsBlock.fields.length > 0 ? [{
                        type: 'section',
                        fields: fieldsBlock.fields,
                    }] : []),
                    ...(originalBlocks.find((b: any) => b.text?.text?.includes('*Items:*')) ? [{
                        type: 'section',
                        text: originalBlocks.find((b: any) => b.text?.text?.includes('*Items:*')).text,
                    }] : []),
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '📋 *Status:* ✅ Fulfilled',
                        },
                    },
                ];
                
                const channelId = payload.container?.channel_id || SLACK_CHANNEL_ID;
                
                await fetch('https://slack.com/api/chat.update', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        channel: channelId,
                        ts: payload.message.ts,
                        text: `✅ Order #${orderId.slice(-8)} fulfilled`,
                        blocks: updatedBlocks,
                    }),
                });
                
                const customerField = fieldsBlock?.fields?.find((f: any) => f.text?.includes('*Customer:*'));
                const customerText = customerField?.text || '';
                const slackMatch = customerText.match(/<@([A-Z0-9]+)>/);
                const slackId = slackMatch?.[1];
                
                if (slackId) {
                    try {
                        await fetch('https://slack.com/api/chat.postMessage', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                'Content-Type': 'application/json; charset=utf-8',
                            },
                            body: JSON.stringify({
                                channel: slackId,
                                text: `✅ Your order #${orderId.slice(-8)} has been fulfilled! It's on its way to you.`,
                            }),
                        });
                    } catch {
                    }
                }
                
                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('refund_order_')) {
                const orderId = action.value;

                const originalBlocks = payload.message.blocks || [];
                const channelId = payload.container?.channel_id || SLACK_CHANNEL_ID;

                const fieldsBlock = originalBlocks.find((b: any) => b.fields && b.fields.length > 0);

                const customerField = fieldsBlock?.fields?.find((f: any) => f.text?.includes('*Customer:*'));
                const customerText = customerField?.text || '';
                const slackMatch = customerText.match(/<@([A-Z0-9]+)>/);
                const slackId = slackMatch?.[1];

                // Pathway-aware refund. Read the order to decide:
                // - Student (points): return pointsSpent to the user's points balance.
                // - Guest (Stripe): never auto-refund; post a manual-refund note for staff.
                // Always flip the order/Slack message to "Refunded".
                let customerRefundText = `↩️ Your order #${orderId.slice(-8)} has been refunded.`;
                try {
                    const { Redis } = await import('@upstash/redis');
                    const redis = new Redis({
                        url: process.env.UPSTASH_REDIS_REST_URL!,
                        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
                    });

                    // Try to find the order as a student order first, and mark it refunded.
                    let studentUserId: string | null = null;
                    let studentOrder: any = null;
                    const userKeys = await redis.keys('user:*:orders');
                    for (const key of userKeys) {
                        const orders = await redis.get<any[]>(key);
                        const match = orders?.find((o: any) => o.id === orderId);
                        if (match) {
                            studentUserId = key.split(':')[1];
                            studentOrder = match;
                            const updatedOrders = orders!.map((o: any) => {
                                if (o.id === orderId) {
                                    return {
                                        ...o,
                                        status: 'refunded',
                                        statusHistory: [...(o.statusHistory || []), { status: 'refunded', timestamp: new Date() }]
                                    };
                                }
                                return o;
                            });
                            await redis.set(`user:${studentUserId}:orders`, updatedOrders);
                            mirrorUpdatedOrder(updatedOrders, orderId, studentUserId);
                            break;
                        }
                    }

                    // Resolve userId from slackId if the order didn't carry one.
                    if (!studentUserId && slackId) {
                        const slackKeys = await redis.keys('user:*:slackId');
                        for (const key of slackKeys) {
                            const stored_slackId = await redis.get<string>(key);
                            if (stored_slackId === slackId) {
                                studentUserId = key.split(':')[1];
                                break;
                            }
                        }
                    }

                    const guestOrder = await getGuestOrder(orderId);
                    const isGuest = (studentOrder?.pathway === 'guest')
                        || (guestOrder?.pathway === 'guest')
                        || (!studentOrder && !!guestOrder);

                    if (isGuest) {
                        // Card order: mark refunded via the guest store; do NOT touch any balance.
                        const order = guestOrder || studentOrder;
                        try {
                            const updated = await updateGuestOrder(orderId, {
                                status: 'refunded',
                                statusHistory: [...((order?.statusHistory) || []), { status: 'refunded', timestamp: new Date() }],
                            });
                            if (updated) void mirrorOrder(updated as any, undefined);
                        } catch {
                        }
                        if (channelId) {
                            await postSlackMessage(channelId, manualStripeRefundNote(order));
                        }
                    } else if (studentOrder || studentUserId) {
                        // Student order: refund POINTS from the order's pointsSpent.
                        const pointsSpent = Number(studentOrder?.pointsSpent) || 0;
                        if (studentUserId && pointsSpent > 0) {
                            await refundStudentPoints(redis, studentUserId, orderId, pointsSpent);
                            customerRefundText += ` ${pointsSpent} points have been returned to your account.`;
                        }
                    } else if (channelId) {
                        // Pathway unknown: safe default — post manual-refund note, never write a balance.
                        await postSlackMessage(channelId, manualStripeRefundNote({ totalAmount: 0 }));
                    }
                } catch {
                }

                const updatedBlocks = [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '↩️ Order Refunded',
                        },
                    },
                    ...(fieldsBlock?.fields && fieldsBlock.fields.length > 0 ? [{
                        type: 'section',
                        fields: fieldsBlock.fields,
                    }] : []),
                    ...(originalBlocks.find((b: any) => b.text?.text?.includes('*Items:*')) ? [{
                        type: 'section',
                        text: originalBlocks.find((b: any) => b.text?.text?.includes('*Items:*')).text,
                    }] : []),
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '📋 *Status:* ↩️ Refunded',
                        },
                    },
                ];

                try {
                    await fetch('https://slack.com/api/chat.update', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                            'Content-Type': 'application/json; charset=utf-8',
                        },
                        body: JSON.stringify({
                            channel: channelId,
                            ts: payload.message.ts,
                            blocks: updatedBlocks,
                        }),
                    });
                } catch {
                }

                if (slackId) {
                    await postSlackMessage(slackId, customerRefundText);
                }

                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('custom_msg_')) {
                const orderId = action.value;
                const messageTs = payload.message.ts;
                const channelId = payload.container.channel_id;
                
                const modalView = {
                    type: 'modal',
                    callback_id: 'custom_msg_modal_order',
                    private_metadata: JSON.stringify({
                        orderId,
                        messageTs,
                        channelId,
                    }),
                    title: {
                        type: 'plain_text',
                        text: 'Send Message',
                    },
                    submit: {
                        type: 'plain_text',
                        text: 'Send',
                    },
                    blocks: [
                        {
                            type: 'input',
                            block_id: 'message_input',
                            label: {
                                type: 'plain_text',
                                text: 'Message to customer',
                            },
                            element: {
                                type: 'plain_text_input',
                                action_id: 'message_text',
                                multiline: true,
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Enter your message here...',
                                },
                            },
                        },
                    ],
                };
                
                await fetch('https://slack.com/api/views.open', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        trigger_id: payload.trigger_id,
                        view: modalView,
                    }),
                });
                
                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('fulfill_')) {
                const transactionId = action.value;
                
                const originalBlocks = payload.message.blocks || [];
                
                const updatedBlocks = [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '✅ Transaction Fulfilled',
                        },
                    },
                    ...(originalBlocks.slice(1)),
                ];
                
                const channelId = payload.container?.channel_id || SLACK_CHANNEL_ID;
                
                await fetch('https://slack.com/api/chat.update', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        channel: channelId,
                        ts: payload.message.ts,
                        text: `✅ Transaction #${transactionId.slice(-8)} fulfilled`,
                        blocks: updatedBlocks,
                    }),
                });
                
                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('refund_')) {
                const transactionId = action.value;

                const originalBlocks = payload.message.blocks || [];

                const amountBlock = originalBlocks.find((b: any) =>
                    b.fields?.some((f: any) => f.text?.includes('*Amount:*'))
                );
                const amountField = amountBlock?.fields?.find((f: any) => f.text?.includes('*Amount:*'));
                const amountText = amountField?.text || '';
                const amountMatch = amountText.match(/\$([0-9.]+)/);
                const refundAmount = amountMatch ? parseFloat(amountMatch[1]) : 0;

                const channelId = payload.container?.channel_id || SLACK_CHANNEL_ID;

                // Credits are retired: do NOT write any user balance/transaction here.
                // This is a card (Stripe) transaction — refund must be done manually.
                // Resolve the transaction as a guest order if possible to surface the
                // Stripe payment intent, otherwise fall back to the parsed dollar amount.
                if (channelId) {
                    let order: any = null;
                    try {
                        order = await getGuestOrder(transactionId);
                    } catch {
                    }
                    const note = manualStripeRefundNote(order || { totalAmount: refundAmount });
                    await postSlackMessage(channelId, note);
                }

                const updatedBlocks = [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '↩️ Donation Refunded',
                        },
                    },
                    ...(originalBlocks.slice(1)),
                ];

                await fetch('https://slack.com/api/chat.update', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        channel: channelId,
                        ts: payload.message.ts,
                        text: `↩️ Donation #${transactionId.slice(-8)} refunded`,
                        blocks: updatedBlocks,
                    }),
                });
                
                return NextResponse.json({ ok: true });
            }

            if (actionId.startsWith('message_')) {
                const transactionId = action.value;
                const messageTs = payload.message.ts;
                const channelId = payload.container.channel_id;
                
                const modalView = {
                    type: 'modal',
                    callback_id: 'message_modal_transaction',
                    private_metadata: JSON.stringify({
                        transactionId,
                        messageTs,
                        channelId,
                    }),
                    title: {
                        type: 'plain_text',
                        text: 'Send Message',
                    },
                    submit: {
                        type: 'plain_text',
                        text: 'Send',
                    },
                    blocks: [
                        {
                            type: 'input',
                            block_id: 'message_input',
                            label: {
                                type: 'plain_text',
                                text: 'Message to donor',
                            },
                            element: {
                                type: 'plain_text_input',
                                action_id: 'message_text',
                                multiline: true,
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Enter your message here...',
                                },
                            },
                        },
                    ],
                };
                
                await fetch('https://slack.com/api/views.open', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify({
                        trigger_id: payload.trigger_id,
                        view: modalView,
                    }),
                });
                
                return NextResponse.json({ ok: true });
            }
        }

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
