import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { isAdmin } from '../../../../../lib/adminAuth';
import { isHcbConfigured, isHcbConnected, clearHcbConnection, getConnectedHcbUser } from '../../../../../lib/hcb';

/**
 * Admin-only: HCB config + connection state, plus WHO the connection
 * authenticates as on HCB (`user`). The connected identity matters because the
 * reconciler reads org transactions on this user's behalf — if they aren't an
 * organizer on the shop org, HCB returns 403 not_authorized.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!(await isAdmin(session))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const connected = await isHcbConnected();
    return NextResponse.json({
        configured: isHcbConfigured(),
        connected,
        // Only look up the identity when connected (avoids a wasted token mint).
        user: connected ? await getConnectedHcbUser() : null,
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
