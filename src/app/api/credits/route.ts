import { NextResponse } from 'next/server';
const userCredits: Record<string, { balance: number; transactions: any[] }> = {};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'anonymous';

    const userData = userCredits[userId] || { balance: 0, transactions: [] };

    return NextResponse.json({
        code: 200,
        result: {
            balance: userData.balance,
            transactions: userData.transactions,
        }
    });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId = 'anonymous', amount, type, description } = body;

        if (!amount || typeof amount !== 'number') {
            return NextResponse.json({
                code: 400,
                error: 'Invalid amount'
            }, { status: 400 });
        }

        if (!userCredits[userId]) {
            userCredits[userId] = { balance: 0, transactions: [] };
        }

        const transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: type === 'deposit' ? amount : -amount,
            type: type || 'deposit',
            description: description || 'Credit transaction',
            timestamp: new Date().toISOString(),
        };

        if (type === 'purchase') {
            if (userCredits[userId].balance < amount) {
                return NextResponse.json({
                    code: 400,
                    error: 'Insufficient credits'
                }, { status: 400 });
            }
            userCredits[userId].balance -= amount;
        } else {
            userCredits[userId].balance += amount;
        }

        userCredits[userId].transactions.unshift(transaction);

        return NextResponse.json({
            code: 200,
            result: {
                balance: userCredits[userId].balance,
                transaction,
            }
        });
    } catch {
        return NextResponse.json({
            code: 500,
            error: 'Internal server error'
        }, { status: 500 });
    }
}
