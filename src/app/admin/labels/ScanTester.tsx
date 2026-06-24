'use client';

import { useState, useCallback } from 'react';
import { useScanInput } from '../receiving/useScanInput';

/**
 * Scan-test widget for the label designer: prove a rendered barcode round-trips.
 * Uses the shared `useScanInput` hook (HQ USB scanner + optional camera) — the same
 * input contract the receive screen uses — and compares the decode to the encoded value.
 */
export default function ScanTester({
    expected,
    onDecode,
}: {
    expected?: string;
    onDecode?: (text: string) => void;
}) {
    const [last, setLast] = useState<string | null>(null);

    const handleScan = useCallback((text: string) => {
        setLast(text);
        onDecode?.(text);
    }, [onDecode]);

    const { inputRef, onKeyDown, videoRef, cameraOn, setCameraOn, cameraError } = useScanInput(handleScan);

    const match = last != null && expected != null
        ? last.trim().toUpperCase() === expected.trim().toUpperCase()
        : null;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-hackclub-green animate-pulse" />
                <span className="text-sm font-bold text-hackclub-slate">
                    Scanner ready — point the HQ scanner here, or
                </span>
                <button
                    type="button"
                    onClick={() => setCameraOn(v => !v)}
                    className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${cameraOn ? 'bg-hackclub-red text-white border-hackclub-red' : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-slate'}`}
                >
                    {cameraOn ? 'Stop camera' : 'Use camera'}
                </button>
            </div>

            <input
                ref={inputRef}
                onKeyDown={onKeyDown}
                inputMode="none"
                aria-label="Scanner input"
                placeholder="Waiting for scan…"
                className="w-full rounded-lg border-2 border-dashed border-hackclub-smoke bg-hackclub-smoke px-3 py-2 font-mono text-sm focus:outline-none focus:border-hackclub-blue"
            />

            {cameraOn && (
                <div className="rounded-xl overflow-hidden border-2 border-hackclub-smoke bg-black">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video ref={videoRef} className="w-full max-h-64 object-contain" />
                </div>
            )}

            {cameraError && <p className="text-sm font-bold text-hackclub-red">{cameraError}</p>}

            {last != null && (
                <div className={`rounded-xl border-2 p-3 ${match === false ? 'border-hackclub-red bg-hackclub-red/5' : 'border-hackclub-green bg-hackclub-green/5'}`}>
                    <div className="text-xs font-black uppercase text-hackclub-muted">Decoded</div>
                    <div className="font-mono text-sm font-bold break-all">{last}</div>
                    {match !== null && (
                        <div className={`mt-1 text-sm font-black ${match ? 'text-hackclub-green' : 'text-hackclub-red'}`}>
                            {match ? '✓ Round-trip matches the encoded value' : '✗ Does not match — check size / print quality'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
