'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Icon from 'supercons';
import { PageHeader, EmptyState, LoadingScreen } from '../ui';
import {
    QUESTIONS,
    ITEMS,
    REACTIONS,
    REACTION_LABELS,
    Reaction,
    BuySignal,
    FeedbackReport,
} from '../../../lib/feedback';

/** localStorage key for the in-progress draft so a refresh mid-call loses nothing. */
const DRAFT_KEY = 'shop:feedbackDraft';

type Draft = {
    id?: string;
    parentName: string;
    role: string;
    answers: Record<string, { note?: string; reactions?: Reaction[] }>;
    items: Record<string, { buy: BuySignal; note?: string }>;
    createdAt?: string;
};

const ROLE_CHOICES = ['Mom', 'Dad', 'Guardian', 'Other'];

function emptyDraft(): Draft {
    return { parentName: '', role: '', answers: {}, items: {} };
}

const BUY_META: Record<Exclude<BuySignal, null>, { label: string; active: string; idle: string }> = {
    yes: {
        label: 'Would buy',
        active: 'bg-hackclub-green text-white border-hackclub-green',
        idle: 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-green',
    },
    maybe: {
        label: 'Maybe',
        active: 'bg-hackclub-yellow text-hackclub-dark border-hackclub-yellow',
        idle: 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-yellow',
    },
    no: {
        label: 'No',
        active: 'bg-hackclub-red text-white border-hackclub-red',
        idle: 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-red',
    },
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** A textarea that grows with its content — no scrollbars mid-call. */
function GrowingTextarea({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-[17px] leading-relaxed text-hackclub-dark placeholder:text-hackclub-muted focus:border-hackclub-cyan focus:bg-white focus:outline-none focus:ring-2 focus:ring-hackclub-cyan/20 transition-colors"
        />
    );
}

/** Compact labeled reaction chips. Small so ten questions don't shout at once. */
function ReactionRow({
    selected,
    onToggle,
}: {
    selected: Reaction[];
    onToggle: (r: Reaction) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {REACTIONS.map((r) => {
                const on = selected.includes(r);
                return (
                    <button
                        key={r}
                        type="button"
                        onClick={() => onToggle(r)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                            on
                                ? 'border-hackclub-cyan bg-hackclub-cyan/10 text-hackclub-dark'
                                : 'border-gray-200 bg-white text-hackclub-muted hover:border-hackclub-cyan/50 hover:text-hackclub-slate'
                        }`}
                        aria-pressed={on}
                        title={REACTION_LABELS[r]}
                    >
                        <span className="text-xl leading-none">{r}</span>
                        <span>{REACTION_LABELS[r]}</span>
                    </button>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FeedbackTool() {
    const [tab, setTab] = useState<'call' | 'reports'>('call');
    const [draft, setDraft] = useState<Draft>(emptyDraft);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [reports, setReports] = useState<FeedbackReport[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);

    // --- restore draft on mount ---
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(DRAFT_KEY);
            if (raw) setDraft({ ...emptyDraft(), ...JSON.parse(raw) });
        } catch {
            /* ignore corrupt draft */
        }
    }, []);

    // --- autosave draft to localStorage on every change ---
    const persistDraft = useCallback((next: Draft) => {
        setDraft(next);
        setSaveState('idle');
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
            } catch {
                /* storage full / disabled — non-fatal */
            }
        }
    }, []);

    // --- mutators ---
    const setField = (patch: Partial<Draft>) => persistDraft({ ...draft, ...patch });

    const setAnswerNote = (qid: string, note: string) =>
        persistDraft({
            ...draft,
            answers: { ...draft.answers, [qid]: { ...draft.answers[qid], note } },
        });

    const toggleReaction = (qid: string, r: Reaction) => {
        const cur = draft.answers[qid]?.reactions || [];
        const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
        persistDraft({
            ...draft,
            answers: { ...draft.answers, [qid]: { ...draft.answers[qid], reactions: next } },
        });
    };

    const setItemBuy = (iid: string, buy: BuySignal) =>
        persistDraft({
            ...draft,
            items: { ...draft.items, [iid]: { ...draft.items[iid], buy } },
        });

    const setItemNote = (iid: string, note: string) =>
        persistDraft({
            ...draft,
            items: { ...draft.items, [iid]: { buy: draft.items[iid]?.buy ?? null, note } },
        });

    // --- server actions ---
    const loadReports = useCallback(async () => {
        setReportsLoading(true);
        try {
            const res = await fetch('/api/admin/feedback');
            if (res.ok) {
                const data = await res.json();
                setReports(data.reports || []);
            }
        } finally {
            setReportsLoading(false);
        }
    }, []);

    const saveReport = async () => {
        setSaveState('saving');
        try {
            const res = await fetch('/api/admin/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: draft.id,
                    parentName: draft.parentName,
                    role: draft.role,
                    answers: draft.answers,
                    items: draft.items,
                    createdAt: draft.createdAt,
                }),
            });
            if (!res.ok) throw new Error('save failed');
            const data = await res.json();
            // Keep the returned id/createdAt so subsequent saves update the same row.
            persistDraft({
                ...draft,
                id: data.report.id,
                createdAt: data.report.createdAt,
            });
            setSaveState('saved');
            setReports((prev) => {
                const rest = prev.filter((r) => r.id !== data.report.id);
                return [data.report, ...rest];
            });
        } catch {
            setSaveState('error');
        }
    };

    const startNewCall = () => {
        if (typeof window !== 'undefined') window.localStorage.removeItem(DRAFT_KEY);
        setDraft(emptyDraft());
        setSaveState('idle');
        setTab('call');
    };

    const loadIntoDraft = (r: FeedbackReport) => {
        const next: Draft = {
            id: r.id,
            parentName: r.parentName || '',
            role: r.role || '',
            answers: r.answers || {},
            items: r.items || {},
            createdAt: r.createdAt,
        };
        persistDraft(next);
        setSaveState('idle');
        setTab('call');
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const removeReport = async (id: string) => {
        setReports((prev) => prev.filter((r) => r.id !== id));
        try {
            await fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch {
            /* best effort; reload will resync */
        }
        if (draft.id === id) startNewCall();
    };

    useEffect(() => {
        if (tab === 'reports') loadReports();
    }, [tab, loadReports]);

    const hasContent =
        draft.parentName.trim() !== '' ||
        draft.role !== '' ||
        Object.keys(draft.answers).length > 0 ||
        Object.keys(draft.items).length > 0;

    return (
        <>
            <PageHeader
                title="Feedback calls"
                subtitle="Talk to a parent, tap through the script, save the report."
                actions={
                    <div className="inline-flex gap-1 rounded-full bg-gray-100 p-1">
                        {(['call', 'reports'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-4 py-1.5 rounded-full font-bold text-sm transition-colors ${
                                    tab === t
                                        ? 'bg-white text-hackclub-dark shadow-sm'
                                        : 'text-hackclub-muted hover:text-hackclub-slate'
                                }`}
                            >
                                {t === 'call' ? 'Run a call' : 'Past reports'}
                            </button>
                        ))}
                    </div>
                }
            />

            <div className="max-w-3xl pb-28">
                {tab === 'call' ? (
                    <CallForm
                        draft={draft}
                        setField={setField}
                        setAnswerNote={setAnswerNote}
                        toggleReaction={toggleReaction}
                        setItemBuy={setItemBuy}
                        setItemNote={setItemNote}
                    />
                ) : (
                    <ReportsList
                        reports={reports}
                        loading={reportsLoading}
                        onOpen={loadIntoDraft}
                        onDelete={removeReport}
                    />
                )}
            </div>

            {/* Sticky save bar (call tab only) */}
            {tab === 'call' && (
                <div className="fixed bottom-0 inset-x-0 border-t border-gray-200 bg-white/90 backdrop-blur z-20">
                    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
                        <div className="text-[15px] min-w-0 truncate">
                            {saveState === 'saving' && <span className="text-hackclub-slate">Saving…</span>}
                            {saveState === 'saved' && (
                                <span className="text-hackclub-green font-bold">✓ Saved to reports</span>
                            )}
                            {saveState === 'error' && (
                                <span className="text-hackclub-red font-bold">Save failed, try again</span>
                            )}
                            {saveState === 'idle' && (
                                <span className="text-hackclub-muted">
                                    {hasContent ? 'Draft saved on this device' : 'Start typing, nothing is required'}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={startNewCall}
                                className="px-4 py-2.5 rounded-full font-semibold text-[15px] text-hackclub-muted hover:text-hackclub-red transition-colors"
                            >
                                New call
                            </button>
                            <button
                                onClick={saveReport}
                                disabled={saveState === 'saving' || !hasContent}
                                className="px-6 py-2.5 rounded-full font-bold text-[15px] bg-hackclub-red text-white hover:bg-hackclub-orange disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {draft.id ? 'Update report' : 'Save report'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Call form
// ---------------------------------------------------------------------------

function CallForm({
    draft,
    setField,
    setAnswerNote,
    toggleReaction,
    setItemBuy,
    setItemNote,
}: {
    draft: Draft;
    setField: (patch: Partial<Draft>) => void;
    setAnswerNote: (qid: string, note: string) => void;
    toggleReaction: (qid: string, r: Reaction) => void;
    setItemBuy: (iid: string, buy: BuySignal) => void;
    setItemNote: (iid: string, note: string) => void;
}) {
    // The product block is inserted after the "values" question so it reads in
    // script order: proud → values → [show items] → design → role → year …
    const beforeItems = QUESTIONS.filter((q) => ['proud', 'values'].includes(q.id));
    const afterItems = QUESTIONS.filter((q) => !['proud', 'values'].includes(q.id));

    // Number the questions in the order they appear on the page, with the item
    // block occupying its own step between values and design.
    let step = 0;

    return (
        <div className="space-y-5">
            {/* Who + legend */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                        <label className="block text-sm font-bold uppercase tracking-wide text-hackclub-muted mb-2">
                            Parent name
                        </label>
                        <input
                            value={draft.parentName}
                            onChange={(e) => setField({ parentName: e.target.value })}
                            placeholder="e.g. Rebecca"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-[17px] text-hackclub-dark placeholder:text-hackclub-muted focus:border-hackclub-cyan focus:bg-white focus:outline-none focus:ring-2 focus:ring-hackclub-cyan/20 transition-colors"
                        />
                    </div>
                    <div>
                        <div className="text-sm font-bold uppercase tracking-wide text-hackclub-muted mb-2">Role</div>
                        <div className="flex flex-wrap gap-2">
                            {ROLE_CHOICES.map((r) => {
                                const on = draft.role === r;
                                return (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setField({ role: on ? '' : r })}
                                        className={`px-4 py-2.5 rounded-full font-semibold text-[15px] border transition-colors ${
                                            on
                                                ? 'bg-hackclub-cyan text-white border-hackclub-cyan'
                                                : 'bg-white text-hackclub-slate border-gray-200 hover:border-hackclub-cyan'
                                        }`}
                                    >
                                        {r}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-hackclub-muted">
                    <span className="font-bold uppercase tracking-wide">Tap to react:</span>
                    {REACTIONS.map((r) => (
                        <span key={r} className="inline-flex items-center gap-1.5">
                            <span className="text-lg">{r}</span> {REACTION_LABELS[r]}
                        </span>
                    ))}
                </div>
            </div>

            {/* Questions — one flat card, hairline-divided rows */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
                {beforeItems.map((q) => (
                    <QuestionRow
                        key={q.id}
                        step={++step}
                        prompt={q.prompt}
                        hint={q.hint}
                        reactions={draft.answers[q.id]?.reactions || []}
                        onToggle={(r) => toggleReaction(q.id, r)}
                        note={draft.answers[q.id]?.note || ''}
                        onNote={(v) => setAnswerNote(q.id, v)}
                    />
                ))}

                {/* Product block — its own step in the script */}
                <div className="p-6">
                    <StepHead step={++step} prompt="Show the 5 items" hint="Show it first, don't explain the backstory. Would they buy it?" />
                    <div className="mt-4 pl-10 space-y-2.5">
                        {ITEMS.map((item) => {
                            const cur = draft.items[item.id]?.buy ?? null;
                            return (
                                <div key={item.id} className="rounded-xl border border-gray-200 px-4 py-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-bold text-hackclub-dark text-[17px]">{item.label}</span>
                                        <div className="flex gap-1.5">
                                            {(['yes', 'maybe', 'no'] as const).map((b) => {
                                                const meta = BUY_META[b];
                                                const on = cur === b;
                                                return (
                                                    <button
                                                        key={b}
                                                        type="button"
                                                        onClick={() => setItemBuy(item.id, on ? null : b)}
                                                        className={`px-3.5 py-2 rounded-full font-semibold text-sm border transition-colors ${
                                                            on ? meta.active : meta.idle
                                                        }`}
                                                    >
                                                        {meta.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {(cur || draft.items[item.id]?.note) && (
                                        <div className="mt-2.5">
                                            <GrowingTextarea
                                                value={draft.items[item.id]?.note || ''}
                                                onChange={(v) => setItemNote(item.id, v)}
                                                placeholder="Notes on this item…"
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {afterItems.map((q) => (
                    <QuestionRow
                        key={q.id}
                        step={++step}
                        prompt={q.prompt}
                        hint={q.hint}
                        reactions={draft.answers[q.id]?.reactions || []}
                        onToggle={(r) => toggleReaction(q.id, r)}
                        note={draft.answers[q.id]?.note || ''}
                        onNote={(v) => setAnswerNote(q.id, v)}
                    />
                ))}
            </div>
        </div>
    );
}

/** Step number + prompt + interviewer tip, shared by question rows and the item block. */
function StepHead({ step, prompt, hint }: { step: number; prompt: string; hint?: string }) {
    return (
        <div className="flex gap-3">
            <span className="shrink-0 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-hackclub-dark text-white text-sm font-bold tabular-nums">
                {step}
            </span>
            <div className="min-w-0">
                <h3 className="text-lg font-bold text-hackclub-dark leading-snug">{prompt}</h3>
                {hint && (
                    <p className="text-[14px] text-hackclub-muted mt-1">
                        <span className="font-semibold text-hackclub-slate">Tip:</span> {hint}
                    </p>
                )}
            </div>
        </div>
    );
}

function QuestionRow({
    step,
    prompt,
    hint,
    reactions,
    onToggle,
    note,
    onNote,
}: {
    step: number;
    prompt: string;
    hint?: string;
    reactions: Reaction[];
    onToggle: (r: Reaction) => void;
    note: string;
    onNote: (v: string) => void;
}) {
    return (
        <div className="p-6">
            <StepHead step={step} prompt={prompt} hint={hint} />
            {/* Reactions + note sit under the prompt, indented to align past the number. */}
            <div className="mt-3.5 pl-10 space-y-3">
                <ReactionRow selected={reactions} onToggle={onToggle} />
                <GrowingTextarea value={note} onChange={onNote} placeholder="Notes…" />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Past reports
// ---------------------------------------------------------------------------

function summarize(r: FeedbackReport): string {
    const yes = Object.values(r.items || {}).filter((i) => i?.buy === 'yes').length;
    const maybe = Object.values(r.items || {}).filter((i) => i?.buy === 'maybe').length;
    // First starred/quote-worthy note, if any.
    const quote = Object.values(r.answers || {}).find(
        (a) => (a.reactions || []).includes('⭐') && a.note,
    )?.note;
    const parts: string[] = [];
    if (yes || maybe) parts.push(`${yes} would buy${maybe ? `, ${maybe} maybe` : ''}`);
    if (quote) parts.push(`“${quote.length > 80 ? quote.slice(0, 77) + '…' : quote}”`);
    return parts.join(' · ') || 'No answers recorded';
}

function formatDate(iso?: string): string {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

function ReportsList({
    reports,
    loading,
    onOpen,
    onDelete,
}: {
    reports: FeedbackReport[];
    loading: boolean;
    onOpen: (r: FeedbackReport) => void;
    onDelete: (id: string) => void;
}) {
    if (loading) {
        return <LoadingScreen />;
    }
    if (reports.length === 0) {
        return <EmptyState message="No reports yet. Run a call and hit Save." />;
    }
    return (
        <div className="space-y-3">
            {reports.map((r) => (
                <div
                    key={r.id}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-gray-300 transition-colors"
                >
                    <div className="flex items-start justify-between gap-4">
                        <button onClick={() => onOpen(r)} className="text-left flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-hackclub-dark text-lg">
                                    {r.parentName || 'Unnamed parent'}
                                </span>
                                {r.role && (
                                    <span className="px-2.5 py-0.5 rounded-full bg-hackclub-cyan/10 text-hackclub-cyan text-sm font-bold">
                                        {r.role}
                                    </span>
                                )}
                            </div>
                            <p className="text-[15px] text-hackclub-slate mt-1">{summarize(r)}</p>
                            <p className="text-sm text-hackclub-muted mt-1">
                                {formatDate(r.createdAt)}
                                {r.interviewer ? ` · ${r.interviewer}` : ''}
                            </p>
                        </button>
                        <button
                            onClick={() => onDelete(r.id)}
                            title="Delete report"
                            className="shrink-0 text-hackclub-muted hover:text-hackclub-red transition-colors p-1"
                        >
                            <Icon glyph="delete" size={20} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
