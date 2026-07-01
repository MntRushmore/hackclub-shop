import { Redis } from '@upstash/redis';

/**
 * Pre-launch parent feedback calls.
 *
 * Rushil runs short feedback calls with parents of Hack Clubbers before the shop
 * opens wide. This is the storage + shared shape behind the call-mode tool at
 * `/admin/feedback`: one report per call, saved to Redis under `feedback:<id>`.
 *
 * The question set lives here so the page and any future export share one source
 * of truth. Reordering/rewording a question is a one-line change; existing
 * reports keep their old answers keyed by id regardless.
 */

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export type BuySignal = 'yes' | 'maybe' | 'no' | null;

/** The emoji reactions Rushil taps mid-call. ⭐ = quote-worthy line. */
export const REACTIONS = ['👍', '😐', '👎', '💡', '⭐'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What each reaction means — shown as a small label so the emoji isn't a mystery. */
export const REACTION_LABELS: Record<Reaction, string> = {
    '👍': 'Loved',
    '😐': 'Meh',
    '👎': 'No',
    '💡': 'Idea',
    '⭐': 'Quote',
};

export interface QuestionAnswer {
    note?: string;
    reactions?: Reaction[];
}

export interface ItemAnswer {
    buy: BuySignal;
    note?: string;
}

export interface FeedbackReport {
    id: string;
    parentName?: string;
    /** mom / dad / guardian / other — free text. */
    role?: string;
    /** Keyed by question id (see QUESTIONS). */
    answers: Record<string, QuestionAnswer>;
    /** Keyed by item id (see ITEMS). */
    items: Record<string, ItemAnswer>;
    createdAt: string;
    updatedAt: string;
    /** Session user name of whoever ran the call. */
    interviewer?: string;
}

/**
 * The call script, in order. `hint` is coaching shown under the prompt — the
 * field-tested lessons from early calls (show the item before the backstory,
 * capture verbatim quotes, offer choices). Editing this array reshapes the page.
 */
export const QUESTIONS: Array<{
    id: string;
    prompt: string;
    hint?: string;
}> = [
    {
        id: 'proud',
        prompt: 'Are you proud of your association with Hack Club?',
        hint: 'Let them talk. Tap a reaction for the feeling.',
    },
    {
        id: 'values',
        prompt: 'What values or parts of Hack Club make you proud?',
        hint: 'Capture their exact words — this is where the gold is. ⭐ a quote.',
    },
    {
        id: 'design',
        prompt: 'Design feedback on the items',
        hint: 'Show the item first, don’t explain the backstory. Fonts big enough? Flattering? Keep branding simple.',
    },
    {
        id: 'addRole',
        prompt: 'Should we add your role? ("Parent of a Creator")',
        hint: 'Offer it as a choice, don’t pitch it.',
    },
    {
        id: 'addYear',
        prompt: 'Should we add the year?',
        hint: 'Early calls reacted well to a year on the item.',
    },
    {
        id: 'membership',
        prompt: 'Membership — what would make it worth it?',
        hint: 'Annual report? Newsletter? Early access? What would feel like a gift / a donation?',
    },
    {
        id: 'tagline',
        prompt: 'Tagline',
        hint: '"You raised a Hack Clubber." / "Hack Club: Creating the future." Which lands?',
    },
    {
        id: 'pricing',
        prompt: 'Pay-what-you-can vs a fixed price?',
        hint: 'Does it feel more like a purchase or a donation to them?',
    },
    {
        id: 'overall',
        prompt: 'Overall / anything else',
        hint: 'The catch-all. ⭐ anything quote-worthy.',
    },
];

/** The 5 products shown during the call. */
export const ITEMS: Array<{ id: string; label: string }> = [
    { id: 'crew', label: 'Crew neck sweatshirt' },
    { id: 'hoodie', label: 'Hoodie' },
    { id: 'tee', label: 'T-shirt' },
    { id: 'mug', label: 'Mug / travel flask' },
    { id: 'cap', label: 'Cap' },
];

export function newReportId(): string {
    return `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Upsert a report by id. Returns the stored report (with updatedAt refreshed). */
export async function saveReport(report: FeedbackReport): Promise<FeedbackReport> {
    const stored: FeedbackReport = { ...report, updatedAt: new Date().toISOString() };
    await redis.set(`feedback:${stored.id}`, stored);
    return stored;
}

export async function getReport(id: string): Promise<FeedbackReport | null> {
    return (await redis.get<FeedbackReport>(`feedback:${id}`)) || null;
}

/** All reports, newest first. */
export async function listReports(): Promise<FeedbackReport[]> {
    const keys = await redis.keys('feedback:*');
    if (keys.length === 0) return [];
    const reports: FeedbackReport[] = [];
    for (const key of keys) {
        const r = await redis.get<FeedbackReport>(key);
        if (r && r.id) reports.push(r);
    }
    reports.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return reports;
}

export async function deleteReport(id: string): Promise<void> {
    await redis.del(`feedback:${id}`);
}
