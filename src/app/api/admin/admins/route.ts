import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { setAdminRole, listAdmins, getAdminRole } from '../../../../lib/adminAuth';
import { recordAudit } from '../../../../lib/auditLog';
import { AdminRole } from '../../../../types/Admin';

function getGlobalAdmins(): string[] {
    const globalAdmins = process.env.GLOBAL_ADMINS || '';
    return globalAdmins.split(',').map(id => id.trim()).filter(Boolean);
}

export async function GET() {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageAdmins');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const admins = await listAdmins();
        const globalAdmins = getGlobalAdmins();

        for (const userId of globalAdmins) {
            if (!admins.find(a => a.userId === userId)) {
                admins.push({ userId, role: 'manager' });
            }
        }

        return NextResponse.json({ admins, globalAdmins });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch admins' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageAdmins');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { userId, role } = body;

        if (!userId || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!['manager', 'store_manager', 'reader'].includes(role)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }

        if (session && session.user?.id === userId && role !== 'manager') {
            return NextResponse.json({ error: 'Cannot downgrade your own role' }, { status: 403 });
        }

        // Global (env-configured) admins are always managers; a Redis role for
        // them would be dead weight or a confusing silent no-op downgrade.
        if (getGlobalAdmins().includes(userId)) {
            return NextResponse.json({ error: 'This user is a global admin (set via GLOBAL_ADMINS); their role can only change in the environment config.' }, { status: 400 });
        }

        const previousRole = await getAdminRole(userId);
        await setAdminRole(userId, role as AdminRole);

        // Granting/escalating admin access is the most security-sensitive admin
        // action there is — always leave a trail.
        void recordAudit({
            action: previousRole ? 'admin.role-change' : 'admin.grant',
            actorId: session!.user!.id!,
            actorEmail: session!.user!.email || undefined,
            target: userId,
            summary: previousRole
                ? `Changed admin ${userId} from ${previousRole} to ${role}`
                : `Granted ${role} admin access to ${userId}`,
            metadata: { from: previousRole, to: role },
        });

        return NextResponse.json(
            { success: true, userId, role },
            { status: 201 }
        );
    } catch {
        return NextResponse.json({ error: 'Failed to invite admin' }, { status: 500 });
    }
}
