import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import {
    FeedbackReport,
    saveReport,
    listReports,
    deleteReport,
    newReportId,
} from '../../../../lib/feedback';

/**
 * Parent feedback reports. Any admin who can view stats can run a call and read
 * the reports — it's an internal note-taking tool, not sensitive financial data.
 */

export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');
    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const reports = await listReports();
        return NextResponse.json({ reports });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');
    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const now = new Date().toISOString();

        const report: FeedbackReport = {
            id: typeof body.id === 'string' && body.id ? body.id : newReportId(),
            parentName: body.parentName || undefined,
            role: body.role || undefined,
            answers: body.answers && typeof body.answers === 'object' ? body.answers : {},
            items: body.items && typeof body.items === 'object' ? body.items : {},
            createdAt: typeof body.createdAt === 'string' && body.createdAt ? body.createdAt : now,
            updatedAt: now,
            interviewer: session?.user?.name || undefined,
        };

        const saved = await saveReport(report);
        return NextResponse.json({ report: saved }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');
    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }
        await deleteReport(id);
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 });
    }
}
