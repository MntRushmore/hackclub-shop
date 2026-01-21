import { NextRequest, NextResponse } from 'next/server';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

interface MessageParams {
    userId: string;
    slackId?: string;
    userEmail?: string;
    message: string;
    blocks?: any[];
}

export async function POST(request: NextRequest) {
    if (!SLACK_BOT_TOKEN) {
        return NextResponse.json({ error: 'Slack bot token not configured' }, { status: 500 });
    }

    try {
        const body: MessageParams = await request.json();
        
        let slackUserId = body.slackId;

        if (!slackUserId && body.userEmail) {
            const lookupResponse = await fetch('https://slack.com/api/users.lookupByEmail', {
                headers: {
                    'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                },
                body: `email=${encodeURIComponent(body.userEmail)}`,
                method: 'POST',
            });

            const lookupData = await lookupResponse.json();
            
            if (!lookupData.ok || !lookupData.user?.id) {
                console.error('Could not find Slack user:', body.userEmail);
                return NextResponse.json({ error: 'User not found' }, { status: 404 });
            }

            slackUserId = lookupData.user.id;
        }

        if (!slackUserId) {
            return NextResponse.json({ error: 'No Slack ID provided' }, { status: 400 });
        }

        const messagePayload: any = {
            channel: slackUserId,
            text: body.message,
        };

        if (body.blocks) {
            messagePayload.blocks = body.blocks;
        }

        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messagePayload),
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(`Slack API error: ${result.error}`);
        }

        return NextResponse.json({ success: true, ts: result.ts });
    } catch (error) {
        console.error('Failed to send user message:', error);
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
