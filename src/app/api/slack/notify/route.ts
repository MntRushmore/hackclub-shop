import { NextRequest, NextResponse } from 'next/server';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || '#credits';

interface TransactionNotification {
    userId: string;
    userEmail: string;
    amount: number;
    claimCode: string;
    transactionId: string;
}

export async function POST(request: NextRequest) {
    if (!SLACK_WEBHOOK_URL) {
        console.error('SLACK_WEBHOOK_URL not configured');
        return NextResponse.json({ error: 'Slack not configured' }, { status: 500 });
    }

    try {
        const body: TransactionNotification = await request.json();
        console.log('Slack notification request:', body);

        const message = {
            channel: SLACK_CHANNEL,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '💳 New Credit Transaction',
                    },
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*User:*\n${body.userEmail}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Amount:*\n$${body.amount.toFixed(2)}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Claim Code:*\n${body.claimCode}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Transaction ID:*\n${body.transactionId}`,
                        },
                    ],
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '✓ Mark as Fulfilled',
                            },
                            value: body.transactionId,
                            action_id: `fulfill_${body.transactionId}`,
                            style: 'primary',
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '💬 Custom Message',
                            },
                            value: body.transactionId,
                            action_id: `message_${body.transactionId}`,
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '↩️ Refund',
                            },
                            value: body.transactionId,
                            action_id: `refund_${body.transactionId}`,
                            style: 'danger',
                        },
                    ],
                },
            ],
        };

        const response = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        if (!response.ok) {
            throw new Error(`Slack API error: ${response.statusText}`);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to send Slack notification:', error);
        return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
    }
}
