import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getProjectById, updateProjectStatus } from '../../../../../../lib/airtable';

export async function POST(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageBalance');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const projectId = params.id;

    try {
        const project = await getProjectById(projectId);

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.status !== 'pending') {
            return NextResponse.json({ error: 'Project has already been reviewed' }, { status: 400 });
        }

        const updatedProject = await updateProjectStatus(
            projectId,
            'rejected',
            session!.user!.id!
        );

        return NextResponse.json({
            success: true,
            project: updatedProject,
        });
    } catch (error) {
        console.error('[Admin Projects API] Reject error:', error);
        return NextResponse.json({ error: 'Failed to reject project' }, { status: 500 });
    }
}
