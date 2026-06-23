import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { getAdminRole, getAdminPermissions } from '../../../../lib/adminAuth';

/**
 * Lightweight "am I an admin?" check for client UI (the nav link, the dashboard
 * gate). Returns the current user's admin role + permissions, or isAdmin:false.
 * Always 200 so the client can read the flag without treating 403 as an error.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return NextResponse.json({ isAdmin: false });
    }

    const role = await getAdminRole(userId);
    if (!role) {
        return NextResponse.json({ isAdmin: false });
    }

    const permissions = await getAdminPermissions(userId);
    return NextResponse.json({ isAdmin: true, role, permissions });
}
