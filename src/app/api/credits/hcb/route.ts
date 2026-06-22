import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { CreditTransaction } from '../../../../types/Credits';
import { mirrorUser } from '../../../../lib/airtableMirror';

const HCB_ORG_SLUG = process.env.HCB_ORG_SLUG || 'ysws-combinator';
const HCB_API_BASE = process.env.HCB_API_BASE || 'https://hcb.hackclub.com/api/v3';

// Initialize Upstash Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface HCBDonation {
    id: string;
    memo?: string | null;
    message?: string | null;
    note?: string | null;
    comment?: string | null;
    amount_cents: number;
    status: string;
    date: string;
    donor?: {
        name: string;
        anonymous: boolean;
        note?: string | null;
    };
}

export async function GET(request: Request) {
    // Require authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({
            code: 401,
            error: 'You must be signed in to claim credits'
        }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.json({
            code: 400,
            error: 'Missing claim code'
        }, { status: 400 });
    }
    const normalizedCode = code.trim().toUpperCase();

    // Verify claim code belongs to this user and is server-issued
    const codeOwner = await redis.get<string>(`claim_code:${normalizedCode}:user`);
    if (!codeOwner) {
        return NextResponse.json({
            code: 400,
            error: 'Invalid claim code. Generate a new one in the credits page.'
        }, { status: 400 });
    }

    if (codeOwner !== userId) {
        return NextResponse.json({
            code: 403,
            error: 'This claim code belongs to a different account'
        }, { status: 403 });
    }

    try {
        // Fetch donations from HCB API
        const response = await fetch(
            `${HCB_API_BASE}/organizations/${HCB_ORG_SLUG}/donations`,
            {
                headers: {
                    'Accept': 'application/json',
                },
                next: { revalidate: 0 }
            }
        );

        if (!response.ok) {
            console.error(`[HCB API] Failed to fetch donations: ${response.status}`);
            return NextResponse.json({
                code: 502,
                error: 'Failed to fetch donations from HCB'
            }, { status: 502 });
        }

        const donations: HCBDonation[] = await response.json();

        // Find donation with matching donor details (case-insensitive)
        const codeLower = normalizedCode.toLowerCase();
        const matchingDonation = donations.find(donation => {
            // Check multiple possible text fields where the donor could have entered the claim code
            const fieldsToCheck = [
                donation.memo,
                donation.message,
                donation.note,
                donation.comment,
                donation.donor?.note,
                donation.donor?.name,
            ].filter(Boolean);

            return fieldsToCheck.some(field =>
                field!.toLowerCase().includes(codeLower)
            );
        });

        if (!matchingDonation) {
            return NextResponse.json({
                code: 404,
                error: `No donation found with code ${normalizedCode}. Make sure you entered the code as your name when donating. If you're sure you donated, take screenshots of both your HCB transaction and this page, then let us know in #hack-club-store.`
            }, { status: 404 });
        }

        // Check if already claimed using Redis
        const isClaimed = await redis.sismember('claimed_donations', matchingDonation.id);
        if (isClaimed) {
            return NextResponse.json({
                code: 409,
                error: 'This donation has already been claimed'
            }, { status: 409 });
        }

        // Check donation status
        if (matchingDonation.status === 'failed' || matchingDonation.status === 'refunded') {
            return NextResponse.json({
                code: 400,
                error: `Donation status is ${matchingDonation.status}`
            }, { status: 400 });
        }

        // Mark as claimed in Redis (globally)
        await redis.sadd('claimed_donations', matchingDonation.id);

        // Convert cents to dollars
        const creditAmount = matchingDonation.amount_cents / 100;

        // Add credits to user's account
        const currentBalance = await redis.get<number>(`user:${userId}:balance`) || 0;
        const currentTransactions = await redis.get<CreditTransaction[]>(`user:${userId}:transactions`) || [];

        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: creditAmount,
            type: 'deposit',
            description: `HCB Donation - $${creditAmount.toFixed(2)}`,
            timestamp: new Date(),
        };

        const newBalance = currentBalance + creditAmount;
        const newTransactions = [transaction, ...currentTransactions];

        await redis.set(`user:${userId}:balance`, newBalance);
        await redis.set(`user:${userId}:transactions`, newTransactions);

        // Store slackId mapping if available
        const slackId = (session.user as { slackId?: string })?.slackId;
        if (slackId) {
            await redis.set(`user:${userId}:slackId`, slackId);
        }

        // Best-effort mirror to Airtable for staff visibility.
        void mirrorUser({ userId, balance: newBalance, slackId, email: session.user?.email ?? undefined });

        // Store which user claimed this donation
        await redis.set(`donation:${matchingDonation.id}:user`, userId);

        return NextResponse.json({
            code: 200,
            result: {
                donationId: matchingDonation.id,
                amount: creditAmount,
                status: matchingDonation.status,
                date: matchingDonation.date,
                donor: matchingDonation.donor?.name || 'Anonymous',
                newBalance,
            }
        });

    } catch (error) {
        console.error('[HCB API] Error:', error);
        return NextResponse.json({
            code: 500,
            error: 'Internal server error'
        }, { status: 500 });
    }
}

// Health check
export async function POST() {
    return NextResponse.json({
        code: 200,
        result: {
            status: 'healthy',
            organization: HCB_ORG_SLUG,
            message: 'HCB donation verification endpoint is ready',
        }
    });
}
