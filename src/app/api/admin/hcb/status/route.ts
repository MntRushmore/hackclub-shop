import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { isAdmin } from '../../../../../lib/adminAuth';
import { isHcbConfigured, isHcbConnected, clearHcbConnection } from '../../../../../lib/hcb';

/** Admin-only: is HCB configured + connected (a refresh token is stored)? */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    return NextResponse.json({
        configured: isHcbConfigured(),
        connected: await isHcbConnected(),
    });
}

/** Admin-only: disconnect HCB (drops the stored refresh token). */
export async function DELETE() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    await clearHcbConnection();
    return NextResponse.json({ connected: false });
}
