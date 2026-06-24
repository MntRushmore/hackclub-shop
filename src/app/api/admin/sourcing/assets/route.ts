import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { put } from '@vercel/blob';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';
import {
    createAsset,
    listAssetsByProduct,
    listAssetsByQuote,
    listAssetsByPO,
} from '../../../../../lib/sourcing';
import { mirrorAsset } from '../../../../../lib/airtableMirror';
import { recordAudit } from '../../../../../lib/auditLog';
import { AssetKind } from '../../../../../types/Sourcing';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — print files (PDF/AI) run bigger than photos
// Design assets are stored and DOWNLOADED, not rendered inline same-origin, so vector
// + print formats are allowed here (unlike the product-image upload, which excludes
// SVG to avoid stored XSS). The asset UI never injects these into an <img>/inline DOM.
const ALLOWED_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'application/postscript', // .ai / .eps
    'application/illustrator',
    'application/zip',
    'application/octet-stream',
]);
const VALID_KINDS: AssetKind[] = ['mockup', 'proof', 'print_ready', 'source', 'photo', 'other'];

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const quoteId = searchParams.get('quoteId');
    const poId = searchParams.get('poId');

    try {
        let assets;
        if (productId) assets = await listAssetsByProduct(productId);
        else if (quoteId) assets = await listAssetsByQuote(quoteId);
        else if (poId) assets = await listAssetsByPO(poId);
        else return NextResponse.json({ error: 'Specify productId, quoteId, or poId' }, { status: 400 });
        return NextResponse.json({ assets });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageSourcing');
    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return NextResponse.json(
            { error: 'Asset uploads are not configured (missing BLOB_READ_WRITE_TOKEN).' },
            { status: 500 },
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }
        if (file.type && !ALLOWED_TYPES.has(file.type)) {
            return NextResponse.json(
                { error: `Unsupported file type: ${file.type}. Use an image, PDF, AI/EPS, or ZIP.` },
                { status: 400 },
            );
        }
        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 25MB.` },
                { status: 400 },
            );
        }

        const kindRaw = String(formData.get('kind') || 'other') as AssetKind;
        const kind: AssetKind = VALID_KINDS.includes(kindRaw) ? kindRaw : 'other';
        const productId = (formData.get('productId') as string) || undefined;
        const variantId = (formData.get('variantId') as string) || undefined;
        const quoteId = (formData.get('quoteId') as string) || undefined;
        const poId = (formData.get('poId') as string) || undefined;
        const label = (formData.get('label') as string) || undefined;
        const assetGroupId = (formData.get('assetGroupId') as string) || undefined;

        if (!productId && !quoteId && !poId) {
            return NextResponse.json(
                { error: 'An asset must attach to a product, quote, or PO' },
                { status: 400 },
            );
        }

        const blob = await put(`sourcing-assets/${file.name}`, file, {
            access: 'public',
            addRandomSuffix: true,
            contentType: file.type || 'application/octet-stream',
        });

        const asset = await createAsset({
            blobUrl: blob.url,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            kind,
            label,
            productId,
            variantId,
            quoteId,
            poId,
            assetGroupId,
            uploadedBy: session!.user!.id!,
        });

        void mirrorAsset(asset);
        void recordAudit({
            action: 'sourcing.asset.create',
            actorId: session!.user!.id!,
            actorEmail: session?.user?.email || undefined,
            target: asset.id,
            summary: `Uploaded ${kind} "${asset.filename}" v${asset.version}`,
            metadata: { productId, quoteId, poId },
        });

        return NextResponse.json({ asset }, { status: 201 });
    } catch (err) {
        console.error('[sourcing/assets]', err);
        return NextResponse.json({ error: 'Failed to upload asset' }, { status: 500 });
    }
}
