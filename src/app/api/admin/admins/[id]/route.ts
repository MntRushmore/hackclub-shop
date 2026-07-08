import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import { setAdminRole, removeAdmin, getAdminRole, listAdmins } from '../../../../../lib/adminAuth';
import { recordAudit } from '../../../../../lib/auditLog';
import { AdminRole } from '../../../../../types/Admin';

function getGlobalAdmins(): string[] {
    const globalAdmins = process.env.GLOBAL_ADMINS || '';
    return globalAdmins.split(',').map(id => id.trim()).filter(Boolean);
}

/**
 * Would removing/downgrading `userId` from manager leave the store with no
 * manager at all? Global (env) admins always count as managers, so with a
 * non-empty GLOBAL_ADMINS this never triggers.
 */
async function isLastManager(userId: string): Promise<boolean> {
    if (getGlobalAdmins().length > 0) return false;
    const admins = await listAdmins();
    const otherManagers = admins.filter(a => a.role === 'manager' && a.userId !== userId);
    const current = admins.find(a => a.userId === userId);
    return current?.role === 'manager' && otherManagers.length === 0;
}

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

        // Global (env-configured) admins are managers by definition; a Redis
        // role write for them is a silent no-op. Reject with a clear error.
        if (getGlobalAdmins().includes(params.id)) {
            return NextResponse.json({ error: 'This user is a global admin (set via GLOBAL_ADMINS); their role can only change in the environment config.' }, { status: 400 });
        }

        // Never let the store end up with zero managers.
        if (role !== 'manager' && (await isLastManager(params.id))) {
            return NextResponse.json({ error: 'Cannot downgrade the last manager.' }, { status: 400 });
        }

        const previousRole = await getAdminRole(params.id);
        await setAdminRole(params.id, role as AdminRole);

        void recordAudit({
            action: 'admin.role-change',
            actorId: session!.user!.id!,
            actorEmail: session!.user!.email || undefined,
            target: params.id,
            summary: `Changed admin ${params.id} from ${previousRole || 'none'} to ${role}`,
            metadata: { from: previousRole, to: role },
        });

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

        // removeAdmin only deletes the Redis role — an env-configured global
        // admin would be silently re-granted on their next request. Reject
        // instead of pretending the removal worked.
        if (getGlobalAdmins().includes(params.id)) {
            return NextResponse.json({ error: 'This user is a global admin (set via GLOBAL_ADMINS) and can only be removed in the environment config.' }, { status: 400 });
        }

        // Never let the store end up with zero managers.
        if (await isLastManager(params.id)) {
            return NextResponse.json({ error: 'Cannot remove the last manager.' }, { status: 400 });
        }

        const previousRole = await getAdminRole(params.id);
        await removeAdmin(params.id);

        void recordAudit({
            action: 'admin.revoke',
            actorId: session!.user!.id!,
            actorEmail: session!.user!.email || undefined,
            target: params.id,
            summary: `Removed admin access from ${params.id} (was ${previousRole || 'unknown'})`,
            metadata: { previousRole },
        });

        return NextResponse.json({ success: true, userId: params.id });
    } catch {
        return NextResponse.json({ error: 'Failed to remove admin' }, { status: 500 });
    }
}
