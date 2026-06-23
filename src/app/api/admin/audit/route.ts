import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { readAudit } from '../../../../lib/auditLog';

/**
 * Read the admin audit trail. Gated on canViewStats so any admin who can see the
 * dashboard can see who did what; the actions themselves stay behind their own
 * permission gates.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canViewStats');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const limit = Math.min(500, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '100', 10) || 100));
    const entries = await readAudit(limit);
    return NextResponse.json({ entries });
}
