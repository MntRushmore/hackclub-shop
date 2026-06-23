import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { put } from '@vercel/blob';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
// SVG deliberately excluded: it can embed <script> and become stored XSS if the
// asset is ever rendered same-origin. Product images don't need vector formats.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return NextResponse.json(
            { error: 'Image uploads are not configured (missing BLOB_READ_WRITE_TOKEN).' },
            { status: 500 },
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { error: `Unsupported file type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP, or GIF.` },
                { status: 400 },
            );
        }

        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 8MB.` },
                { status: 400 },
            );
        }

        const blob = await put(`products/${file.name}`, file, {
            access: 'public',
            addRandomSuffix: true,
            contentType: file.type,
        });

        return NextResponse.json({ url: blob.url }, { status: 201 });
    } catch (error) {
        console.error('[upload] failed:', error);
        return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }
}
