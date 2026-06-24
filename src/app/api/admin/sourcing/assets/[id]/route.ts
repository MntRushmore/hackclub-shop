import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getAsset, deleteAsset } from '../../../../../../lib/sourcing';
import { unmirrorAsset } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const asset = await getAsset(params.id);
        if (!asset) {
            return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
        }

        // Remove the record + reverse indexes. The blob itself is left in place
        // (cheap, and keeps any external links from 404ing); the record is the
        // source of truth for what's "attached".
        await deleteAsset(params.id);
        void unmirrorAsset(params.id);
        void recordAudit({
            action: 'sourcing.asset.delete',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: params.id,
            summary: `Removed asset "${asset.filename}" v${asset.version}`,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 });
    }
}
