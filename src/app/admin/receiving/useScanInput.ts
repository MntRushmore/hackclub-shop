'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * The scanner-input contract shared by the label scan-tester and the receive screen.
 *
 * Two inputs, one decoded string. (1) The HQ USB scanner / keyboard wedge — bind
 * `onKeyDown` to an always-focused field; it captures the typed payload terminated by
 * Enter, with a keystroke-burst detector so a stray slow human keypress can't fire a
 * phantom scan. (2) The phone/webcam camera via ZXing — set `cameraOn` true and attach
 * `videoRef` to a <video>; ZXing is dynamically imported only then (it's heavy).
 *
 * Both call `onScan(text)`. Hardware-scanner-first: the field refocuses aggressively so
 * the operator never has to click before scanning.
 */
export function useScanInput(onScan: (text: string) => void) {
    const [cameraOn, setCameraOn] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const controlsRef = useRef<{ stop: () => void } | null>(null);

    const bufRef = useRef('');
    const lastKeyTsRef = useRef(0);
    const onScanRef = useRef(onScan);
    useEffect(() => { onScanRef.current = onScan; }, [onScan]);

    const fire = useCallback((text: string) => {
        const t = text.trim();
        if (t) onScanRef.current(t);
    }, []);

    // Keep the HID field focused so the USB scanner always lands somewhere.
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        const refocus = () => {
            const active = document.activeElement as HTMLElement | null;
            // Don't steal focus from another text field the operator is using.
            const typing = active && active !== el && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
            if (!typing && active !== el) el.focus();
        };
        el.focus();
        const id = window.setInterval(refocus, 800);
        window.addEventListener('focus', refocus);
        return () => { window.clearInterval(id); window.removeEventListener('focus', refocus); };
    }, []);

    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        const now = e.timeStamp;
        if (now - lastKeyTsRef.current > 120) bufRef.current = '';   // burst gap → reset
        lastKeyTsRef.current = now;

        if (e.key === 'Enter') {
            const val = (bufRef.current || (e.currentTarget.value ?? '')).trim();
            bufRef.current = '';
            e.currentTarget.value = '';
            if (val) fire(val);
            e.preventDefault();
            return;
        }
        if (e.key.length === 1) bufRef.current += e.key;
    }, [fire]);

    // Camera (ZXing) — dynamically imported on toggle.
    useEffect(() => {
        if (!cameraOn) { controlsRef.current?.stop(); controlsRef.current = null; return; }
        let cancelled = false;
        (async () => {
            try {
                if (!videoRef.current) return;
                const { BrowserMultiFormatReader } = await import('@zxing/browser');
                if (cancelled || !videoRef.current) return;
                const reader = new BrowserMultiFormatReader();
                const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
                    if (result) fire(result.getText());
                });
                if (cancelled) controls.stop();
                else controlsRef.current = controls;
            } catch (err) {
                setCameraError(err instanceof Error ? err.message : 'Camera unavailable');
                setCameraOn(false);
            }
        })();
        return () => { cancelled = true; controlsRef.current?.stop(); controlsRef.current = null; };
    }, [cameraOn, fire]);

    return { inputRef, onKeyDown, videoRef, cameraOn, setCameraOn, cameraError };
}
