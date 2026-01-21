import { NextRequest, NextResponse } from 'next/server';

const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

interface OrderItem {
    name: string;
    price: number;
    quantity: number;
}

interface PurchaseNotification {
    orderId: string;
    userId: string;
    userEmail: string;
    slackId?: string;
    items: OrderItem[];
    totalAmount: number;
    newBalance: number;
}

export async function POST(request: NextRequest) {
    if (!SLACK_CHANNEL_ID) {
        console.error('SLACK_CHANNEL_ID not configured');
        return NextResponse.json({ error: 'Slack channel not configured' }, { status: 500 });
    }

    try {
        const body: PurchaseNotification = await request.json();
        console.log('Slack purchase notification:', body);

        const itemsList = body.items
            .map(item => `• ${item.name} x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}`)
            .join('\n');

        const message = {
            channel: SLACK_CHANNEL_ID,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '🛍️ New Store Purchase',
                    },
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Order ID:*\n${body.orderId.slice(-8)}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Customer:*\n${body.slackId ? `<@${body.slackId}>` : body.userEmail}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Total:*\n$${body.totalAmount.toFixed(2)}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Remaining Balance:*\n$${body.newBalance.toFixed(2)}`,
                        },
                    ],
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Items:*\n${itemsList}`,
                    },
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '✓ Approve',
                            },
                            value: body.orderId,
                            action_id: `approve_order_${body.orderId}`,
                            style: 'primary',
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '✕ Deny',
                            },
                            value: body.orderId,
                            action_id: `deny_order_${body.orderId}`,
                            style: 'danger',
                        },
                    ],
                },
            ],
        };

        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(message),
        });

        const result = await response.json();
        
        if (!result.ok) {
            throw new Error(`Slack API error: ${result.error}`);
        }

        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/slack/message-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userEmail: body.userEmail,
                    slackId: body.slackId,
                    userId: body.userId,
                    message: `📦 Your order #${body.orderId.slice(-8)} is pending fulfillment! We'll notify you when it's approved.`,
                }),
            });
        } catch (error) {
            console.error('Failed to DM user about pending order:', error);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to send Slack purchase notification:', error);
        return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
    }
}
