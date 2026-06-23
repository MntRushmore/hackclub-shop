import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { getProjectSubmissions } from '../../../../lib/airtable';

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as 'pending' | 'approved' | 'rejected' | null;

        const projects = await getProjectSubmissions(status || undefined);

        return NextResponse.json({ projects });
    } catch (error) {
        console.error('[Admin Projects API] Fetch error:', error);
        return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }
}
