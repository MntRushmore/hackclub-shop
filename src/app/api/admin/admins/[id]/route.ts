import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { setAdminRole, removeAdmin } from '../../../../../lib/adminAuth';
import { AdminRole } from '../../../../../types/Admin';

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageAdmins');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { role } = body;

        if (!role) {
            return NextResponse.json({ error: 'Missing role' }, { status: 400 });
        }

        if (!['manager', 'store_manager', 'reader'].includes(role)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }

        if (session && session.user?.id === params.id && role !== 'manager') {
            return NextResponse.json({ error: 'Cannot downgrade your own role' }, { status: 403 });
        }

        await setAdminRole(params.id, role as AdminRole);

        return NextResponse.json({ success: true, userId: params.id, role });
    } catch {
        return NextResponse.json({ error: 'Failed to update admin' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageAdmins');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        if (session && session.user?.id === params.id) {
            return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 403 });
        }

        await removeAdmin(params.id);

        return NextResponse.json({ success: true, userId: params.id });
    } catch {
        return NextResponse.json({ error: 'Failed to remove admin' }, { status: 500 });
    }
}
