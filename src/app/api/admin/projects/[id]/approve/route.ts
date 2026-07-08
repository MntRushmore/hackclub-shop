import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../../lib/adminAuth';
import { getProjectById, updateProjectStatus } from '../../../../../../lib/airtable';
import { recordAudit } from '../../../../../../lib/auditLog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const POINTS_PER_HOUR = 5;
const pointsBalanceKey = (userId: string) => `user:${userId}:pointsBalance`;
const pointsTxKey = (userId: string) => `user:${userId}:pointsTransactions`;

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

        const pointsAwarded = hoursApproved * POINTS_PER_HOUR;
        const userId = project.userId;
        // Atomic increment — a double-click on Approve or a concurrent admin
        // grant can't lose an update the way get-then-set could.
        const newBalance = await redis.incrby(pointsBalanceKey(userId), pointsAwarded);

        const transaction = {
            id: `ptxn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: pointsAwarded,
            type: 'earn',
            description: `Project approved: ${project.firstName} ${project.lastName} - ${hoursApproved} hours @ ${POINTS_PER_HOUR} pts/hr`,
            timestamp: new Date(),
        };

        const transactions = (await redis.get<unknown[]>(pointsTxKey(userId))) || [];
        await redis.set(pointsTxKey(userId), [transaction, ...transactions]);

        // Points are money — approvals mint them, so they go on the audit trail
        // like every other balance mutation.
        void recordAudit({
            action: 'points.grant',
            actorId: session!.user!.id!,
            actorEmail: session!.user!.email || undefined,
            target: userId,
            summary: `Approved project ${projectId} for ${hoursApproved}h: +${pointsAwarded} points to ${userId}`,
            metadata: { projectId, hoursApproved, pointsAwarded },
        });

        return NextResponse.json({
            success: true,
            project: updatedProject,
            hoursApproved,
            pointsAwarded,
            newBalance,
        });
    } catch (error) {
        console.error('[Admin Projects API] Approve error:', error);
        return NextResponse.json({ error: 'Failed to approve project' }, { status: 500 });
    }
}
