import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getProjectById, updateProjectStatus } from '../../../../../../lib/airtable';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HOURLY_RATE = 5;

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
        const body = await request.json();
        const { hoursApproved } = body;

        if (typeof hoursApproved !== 'number' || hoursApproved <= 0) {
            return NextResponse.json({ error: 'Hours approved must be a positive number' }, { status: 400 });
        }

        const project = await getProjectById(projectId);

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.status !== 'pending') {
            return NextResponse.json({ error: 'Project has already been reviewed' }, { status: 400 });
        }

        if (!project.userId) {
            return NextResponse.json({ error: 'Project has no associated user ID' }, { status: 400 });
        }

        const updatedProject = await updateProjectStatus(
            projectId,
            'approved',
            session!.user!.id!,
            hoursApproved
        );

        const creditsAwarded = hoursApproved * HOURLY_RATE;
        const userId = project.userId;
        const currentBalance = (await redis.get<number>(`user:${userId}:balance`)) || 0;
        const newBalance = currentBalance + creditsAwarded;

        await redis.set(`user:${userId}:balance`, newBalance);

        const transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: creditsAwarded,
            type: 'deposit',
            description: `Project approved: ${project.firstName} ${project.lastName} - ${hoursApproved} hours @ $${HOURLY_RATE}/hr`,
            timestamp: new Date(),
        };

        const transactions = (await redis.get<unknown[]>(`user:${userId}:transactions`)) || [];
        await redis.set(`user:${userId}:transactions`, [transaction, ...transactions]);

        return NextResponse.json({
            success: true,
            project: updatedProject,
            hoursApproved,
            creditsAwarded,
            newBalance,
        });
    } catch (error) {
        console.error('[Admin Projects API] Approve error:', error);
        return NextResponse.json({ error: 'Failed to approve project' }, { status: 500 });
    }
}
