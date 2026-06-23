import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { syncInventoryFromAirtable, isInventorySyncConfigured } from '../../../../../lib/inventory';

/**
 * Pull variant stock from Airtable into the Redis inventory cache on demand.
 * Bypasses the min-interval guard (force) since an admin explicitly asked.
 */
export async function POST() {
    const session = await getServerSession(authOptions);
    const can = await requireAdminPermission(session, 'canManageProducts');
    if (!can.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    if (!isInventorySyncConfigured()) {
        return NextResponse.json({ ok: false, error: 'Airtable is not configured.' }, { status: 200 });
    }

    const result = await syncInventoryFromAirtable(true);
    if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.reason || 'Sync failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, synced: result.synced });
}
