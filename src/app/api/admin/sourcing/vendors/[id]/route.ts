import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getVendor, updateVendor, deleteVendor } from '../../../../../../lib/sourcing';
import { mirrorVendor, unmirrorVendor } from '../../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../../lib/auditLog';

export async function GET(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const vendor = await getVendor(params.id);
    if (!vendor) {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }
    return NextResponse.json({ vendor });
}

export async function PUT(
    request: Request,
    { params }: { params: { id: string } },
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        if (body.name !== undefined && !String(body.name).trim()) {
            return NextResponse.json({ error: 'Vendor name cannot be empty' }, { status: 400 });
        }

        const updated = await updateVendor(params.id, {
            name: body.name !== undefined ? String(body.name).trim() : undefined,
            website: body.website !== undefined ? String(body.website).trim() || undefined : undefined,
            contactName:
                body.contactName !== undefined ? String(body.contactName).trim() || undefined : undefined,
            contactEmail:
                body.contactEmail !== undefined ? String(body.contactEmail).trim() || undefined : undefined,
            notes: body.notes !== undefined ? String(body.notes).trim() || undefined : undefined,
            tags: Array.isArray(body.tags)
                ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
                : undefined,
        });

        if (!updated) {
            return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
        }

        void mirrorVendor(updated);
        void recordAudit({
            action: 'sourcing.vendor.update',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: updated.id,
            summary: `Updated vendor "${updated.name}"`,
        });

        return NextResponse.json({ vendor: updated });
    } catch {
        return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 });
    }
}

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
        const vendor = await getVendor(params.id);
        if (!vendor) {
            return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
        }

        await deleteVendor(params.id);
        void unmirrorVendor(params.id);
        void recordAudit({
            action: 'sourcing.vendor.delete',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: params.id,
            summary: `Deleted vendor "${vendor.name}"`,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete vendor' }, { status: 500 });
    }
}
