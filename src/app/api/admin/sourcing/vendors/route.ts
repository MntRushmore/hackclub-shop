import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { createVendor, listVendors } from '../../../../../lib/sourcing';
import { mirrorVendor } from '../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../lib/auditLog';

export async function GET() {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const vendors = await listVendors();
        return NextResponse.json({ vendors });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 });
        }

        const vendor = await createVendor({
            name,
            website: body.website?.trim() || undefined,
            contactName: body.contactName?.trim() || undefined,
            contactEmail: body.contactEmail?.trim() || undefined,
            notes: body.notes?.trim() || undefined,
            tags: Array.isArray(body.tags)
                ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
                : undefined,
        });

        void mirrorVendor(vendor);
        void recordAudit({
            action: 'sourcing.vendor.create',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: vendor.id,
            summary: `Created vendor "${vendor.name}"`,
        });

        return NextResponse.json({ vendor }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 });
    }
}
