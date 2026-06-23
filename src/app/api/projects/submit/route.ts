import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { createProjectSubmission } from '../../../../lib/airtable';
import { rateLimit, rateLimitResponse } from '../../../../lib/rateLimit';

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: 'You must be signed in to submit a project' }, { status: 401 });
    }

    const userId = session.user.id;

    const rateLimitResult = await rateLimit(`projects:submit:${userId}`, { maxRequests: 5, windowMs: 3600000 });
    if (!rateLimitResult.success) {
        return rateLimitResponse();
    }

    try {
        const body = await request.json();
        const { 
            firstName, 
            lastName, 
            email, 
            address, 
            school, 
            birthDate, 
            slackId, 
            githubRepo, 
            githubPagesUrl 
        } = body;

        if (!firstName || !lastName || !email || !address || !school || !birthDate || !slackId || !githubRepo || !githubPagesUrl) {
            return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
        }

        const urlRegex = /^https?:\/\/.+/;
        if (!urlRegex.test(githubRepo)) {
            return NextResponse.json({ error: 'GitHub Repository must be a valid URL' }, { status: 400 });
        }
        if (!urlRegex.test(githubPagesUrl)) {
            return NextResponse.json({ error: 'GitHub Pages URL must be a valid URL' }, { status: 400 });
        }

        const project = await createProjectSubmission({
            firstName,
            lastName,
            email,
            address,
            school,
            birthDate,
            slackId,
            githubRepo,
            githubPagesUrl,
            userId,
        });

        return NextResponse.json({ success: true, project });
    } catch (error) {
        console.error('[Projects API] Submit error:', error);
        return NextResponse.json({ error: 'Failed to submit project' }, { status: 500 });
    }
}
