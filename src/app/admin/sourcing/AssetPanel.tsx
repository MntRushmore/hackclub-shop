'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Asset, AssetKind } from '../../../types/Sourcing';

/**
 * Reusable design/art asset strip. Attaches to exactly one of product / quote / PO
 * (pass the matching id). The same underlying asset can appear on all three because
 * the upload sets multiple target ids — but a single panel scopes to one target.
 *
 * Images render as thumbnails; non-previewable files (PDF/AI/print) show a labeled
 * chip. Uploading a new version of a group bumps its version; latest shows first.
 */

const KINDS: AssetKind[] = ['mockup', 'proof', 'print_ready', 'source', 'photo', 'other'];
const KIND_LABEL: Record<AssetKind, string> = {
    mockup: 'Mockup',
    proof: 'Proof',
    print_ready: 'Print-ready',
    source: 'Source',
    photo: 'Photo',
    other: 'Other',
};

const isImage = (mime: string) => mime.startsWith('image/') && mime !== 'image/svg+xml';

interface Props {
    productId?: string;
    quoteId?: string;
    poId?: string;
    variantId?: string;
    /** Compact heading; defaults to "Assets". */
    title?: string;
}

export default function AssetPanel({ productId, quoteId, poId, variantId, title = 'Assets' }: Props) {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [kind, setKind] = useState<AssetKind>('mockup');
    const fileRef = useRef<HTMLInputElement>(null);

    const queryKey = productId
        ? `productId=${productId}`
        : quoteId
            ? `quoteId=${quoteId}`
            : poId
                ? `poId=${poId}`
                : '';

    const load = useCallback(async () => {
        if (!queryKey) return;
        try {
            const res = await fetch(`/api/admin/sourcing/assets?${queryKey}`);
            if (!res.ok) {
                setError('Failed to load assets');
                return;
            }
            const data = await res.json();
            setAssets(data.assets || []);
        } catch {
            setError('Failed to load assets');
        } finally {
            setLoading(false);
        }
    }, [queryKey]);

    useEffect(() => {
        load();
    }, [load]);

    const upload = async (file: File, assetGroupId?: string) => {
        setUploading(true);
        setError(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('kind', kind);
            if (productId) fd.append('productId', productId);
            if (variantId) fd.append('variantId', variantId);
            if (quoteId) fd.append('quoteId', quoteId);
            if (poId) fd.append('poId', poId);
            if (assetGroupId) fd.append('assetGroupId', assetGroupId);

            const res = await fetch('/api/admin/sourcing/assets', { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Upload failed');
                return;
            }
            await load();
        } catch {
            setError('Upload failed');
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const remove = async (id: string) => {
        if (!confirm('Remove this asset?')) return;
        try {
            const res = await fetch(`/api/admin/sourcing/assets/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError('Failed to remove asset');
                return;
            }
            setAssets((prev) => prev.filter((a) => a.id !== id));
        } catch {
            setError('Failed to remove asset');
        }
    };

    // Show only the latest version per group; older versions tuck behind a count.
    const latestByGroup = new Map<string, Asset>();
    const groupSizes = new Map<string, number>();
    for (const a of assets) {
        groupSizes.set(a.assetGroupId, (groupSizes.get(a.assetGroupId) || 0) + 1);
        const cur = latestByGroup.get(a.assetGroupId);
        if (!cur || a.version > cur.version) latestByGroup.set(a.assetGroupId, a);
    }
    const latest = Array.from(latestByGroup.values());

    return (
        <div className="mt-3 border-2 border-hackclub-smoke rounded-xl p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <span className="font-black text-hackclub-dark text-sm">{title}</span>
                <div className="flex items-center gap-2">
                    <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as AssetKind)}
                        className="text-sm px-2 py-1 border-2 border-hackclub-smoke rounded-lg text-hackclub-dark font-medium"
                    >
                        {KINDS.map((k) => (
                            <option key={k} value={k}>{KIND_LABEL[k]}</option>
                        ))}
                    </select>
                    <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) upload(f);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        className="text-sm font-bold bg-hackclub-blue/10 text-hackclub-blue px-3 py-1 rounded-lg hover:bg-hackclub-blue/20 disabled:opacity-50"
                    >
                        {uploading ? 'Uploading…' : '+ Upload'}
                    </button>
                </div>
            </div>

            {error && <p className="text-hackclub-red text-sm font-bold mb-2">{error}</p>}

            {loading ? (
                <p className="text-hackclub-slate text-sm">Loading…</p>
            ) : latest.length === 0 ? (
                <p className="text-hackclub-slate text-sm">No assets attached yet.</p>
            ) : (
                <div className="flex flex-wrap gap-3">
                    {latest.map((a) => {
                        const versions = groupSizes.get(a.assetGroupId) || 1;
                        return (
                            <div key={a.id} className="w-28 group relative">
                                <a href={a.blobUrl} target="_blank" rel="noopener noreferrer" className="block">
                                    {isImage(a.mimeType) ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={a.blobUrl} alt={a.label || a.filename} className="w-28 h-28 object-cover rounded-lg border-2 border-hackclub-smoke" />
                                    ) : (
                                        <div className="w-28 h-28 rounded-lg border-2 border-hackclub-smoke bg-hackclub-smoke/30 flex flex-col items-center justify-center text-center p-2">
                                            <span className="text-2xl">📄</span>
                                            <span className="text-[10px] font-bold text-hackclub-slate break-all line-clamp-2">{a.filename}</span>
                                        </div>
                                    )}
                                </a>
                                <div className="mt-1">
                                    <span className="text-[10px] font-black bg-hackclub-slate/10 text-hackclub-slate px-1.5 py-0.5 rounded-full">
                                        {KIND_LABEL[a.kind]}
                                    </span>
                                    {versions > 1 && (
                                        <span className="text-[10px] text-hackclub-slate ml-1">v{a.version} · {versions} versions</span>
                                    )}
                                </div>
                                <div className="mt-0.5 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.onchange = () => {
                                                const f = input.files?.[0];
                                                if (f) upload(f, a.assetGroupId);
                                            };
                                            input.click();
                                        }}
                                        className="text-[10px] font-bold text-hackclub-blue hover:underline"
                                    >
                                        New version
                                    </button>
                                    <button type="button" onClick={() => remove(a.id)} className="text-[10px] font-bold text-hackclub-red hover:underline">
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
