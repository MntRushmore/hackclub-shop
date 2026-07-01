# Feedback Survey — call-mode tool (self-prompt + plan)

**Owner:** Rushil (philanthropy intern). **Audience being surveyed:** parents of Hack
Clubbers. **When it's used:** live, on a phone/Zoom call. Rushil talks, the parent
reacts, and Rushil taps through this page one-handed while listening.

This is an *internal admin tool*, not a public form. The parent never touches it.
It must be fast to fill, forgiving (nothing required), and impossible to lose work in.

---

## The job (why this exists)

Rushil is running pre-launch feedback calls with a handful of parents before the shop
opens wide. Each call follows a script (below). Today he'd be scribbling on paper and
losing the nuance. This page turns the call into a structured, saved report:

- **Quick notes** per question — type a phrase while they talk, don't lose the thread.
- **Emoji reactions** — one tap to capture the *feeling* (👍 loved it / 😐 meh / 👎 no /
  💡 idea / ⭐ quote-worthy) without breaking eye contact.
- **Per-item buy signal** — for each of the 5 products, would they buy? tap yes/maybe/no.
- **Save the report** — one button, lands in Redis, shows up in a list of past calls.

The bar: Rushil should be able to run a whole call inside this one page without ever
reaching for a second tool, and walk away with a report he can skim in 20 seconds later.

---

## The feedback script (the content — this drives the question set)

**Intro (read to parent):** "We're excited to be building a shop for parents of Hack
Clubbers. We'd love your feedback before we launch."

1. **Role** — mom / dad / guardian / other (free text ok).
2. **Are you proud of your association with Hack Club?** (reaction + note)
3. **What values or parts of Hack Club make you proud?** (note — capture their words verbatim)
4. **Can I show you a few items?** → the product block:
   - 5 items: **crew neck sweatshirt, hoodie, t-shirt, mug / travel flask, cap.**
   - Per item: **would you buy it?** (yes / maybe / no) + a note.
   - **Design feedback** (one note across the set — fonts, flattering fit, simplicity).
5. **Should we add your role?** ("Parent of a Creator", etc.) — reaction + note.
6. **Should we add the year?** — reaction + note.
7. **Membership** — what would make it worth it? (annual report / newsletter / early
   access) — note + reaction.
8. **Tagline** — free note. ("Hack Club: Creating the future", "You raised a Hack Clubber.")
9. **Pay-what-you-can vs fixed price?** — reaction + note.
10. **Overall / anything else** — the catch-all note + a ⭐ for quote-worthy lines.

### Field-tested lessons from Rebecca's call (bake these into the UI copy / hints)
- **Don't lead with the backstory.** Show the item, ask if they'd buy, *then* the story.
  → Put a hint on the product question: "show first, don't explain."
- **Present options and let them choose** — she liked being offered choices, not pitched.
- **Capture verbatim quotes** — the gold was her exact words ("You raised a Hack Clubber,"
  "Parent of a Creator," "felt like a donation"). The ⭐ reaction + a quote note is for this.
- Specific reactions she gave, so we know the question set is right:
  - Liked the **year** on the item. → keep Q6.
  - Liked **"you raised a Hack Clubber."** → tagline Q8.
  - Liked it **feeling like a gift / a donation.** → membership + pay-what-you-can Qs.
  - **Keep branding simple**, no individual YSWS, **bigger font.** → design-feedback note.
  - Mug vs thermos, hoodie vs collar — real either/or prompts. → per-item + design notes.
- One miss to fix in the tool: "**You didn't write it down.**" The whole point of this page
  is that it's *effortless to write it down mid-sentence.* Notes must autosave; never block.

---

## Non-negotiable product constraints

1. **Nothing is required.** A call is messy; questions get skipped or answered out of order.
   Save must work with any subset filled in.
2. **No data loss.** Autosave a draft to `localStorage` on every keystroke/tap so a dropped
   call or refresh never wipes 20 minutes of notes. Explicit "Save report" commits to server.
3. **One-handed & fast.** Big tap targets for reactions/buy-signal. Notes are plain
   `<textarea>`s that grow. No modals mid-call. No confirm dialogs on the happy path.
4. **Admin-only, reuse the existing gate.** Same pattern as every other `/admin/*` page:
   client checks access via an admin API; server routes gate on `requireAdminPermission`.

---

## Where it fits in the codebase (conventions to match — verified)

- **Route:** new page at `src/app/admin/feedback/page.tsx`. Add a tile to the admin
  dashboard grid in `src/app/admin/page.tsx` (copy an existing `<motion.div>` card;
  glyph e.g. `message` or `emote-heart`, a `hackclub-*` accent color).
- **API:** `src/app/api/admin/feedback/route.ts`
  - `GET` → list all reports (gate: `requireAdminPermission(session, 'canViewStats')`).
  - `POST` → create/update a report (same gate; `canViewStats` is the lightest gate every
    admin role has, correct for a tool any admin runs on a call).
  - Optional `DELETE` by id for cleaning up test rows.
- **Storage:** Upstash Redis, instantiated per-file exactly like `src/lib/orderStore.ts`:
  ```ts
  const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  ```
  Key scheme: `feedback:<id>` for each report; list via `redis.keys('feedback:*')`
  (mirrors the coupons route). Put shared types + a tiny store helper in
  `src/lib/feedback.ts` if the route gets fat, else inline is fine.
- **Report shape (draft):**
  ```ts
  type BuySignal = 'yes' | 'maybe' | 'no' | null;
  type Reaction  = '👍' | '😐' | '👎' | '💡' | '⭐' | null; // multi-select set per question
  interface FeedbackReport {
    id: string;                 // `feedback_${Date.now()}_${rand}` (matches coupon id style)
    parentName?: string;
    role?: string;              // mom/dad/guardian/other
    answers: Record<string, { note?: string; reactions?: Reaction[] }>; // keyed by question id
    items: Record<'crew'|'hoodie'|'tee'|'mug'|'cap', { buy: BuySignal; note?: string }>;
    createdAt: string;          // ISO
    updatedAt: string;
    interviewer?: string;       // session user name, auto-filled
  }
  ```
- **Design language (match the rest of admin):**
  - Tailwind `hackclub-*` tokens (`hackclub-red #EC3750`, `cyan`, `purple`, `green`,
    `dark`, `slate`, `smoke`). Blueprint grid background (see `admin/page.tsx` inline style).
  - `font-black` headings, `rounded-2xl` cards, `border-2 border-hackclub-smoke`, soft shadow.
  - `supercons` `<Icon glyph=... />`. `framer-motion` fade/slide on section mount.
  - Client component (`'use client'`), `useSession` + admin check like `admin/page.tsx`.

---

## Build plan (small, verifiable steps)

1. **Types + store** — `src/lib/feedback.ts`: the `FeedbackReport` type, `saveReport`,
   `listReports`, `getReport`, `deleteReport` over Redis. One question-set constant
   (`QUESTIONS`, `ITEMS`) so the page and any future export share one source of truth.
2. **API route** — `src/app/api/admin/feedback/route.ts`: GET (list) + POST (upsert) +
   DELETE, all gated on `canViewStats`, thin wrappers over the store. Match the coupons
   route's shape (session → permission check → try/catch → `NextResponse.json`).
3. **The call page** — `src/app/admin/feedback/page.tsx`:
   - Admin gate + loading/denied states (lift from `admin/page.tsx`).
   - Two tabs / views: **"Run a call"** (the live form) and **"Past reports"** (list).
   - **Run a call:** header field for parent name + role chips; then a vertical stack of
     question cards (each = prompt + hint + reaction row + growing textarea); the product
     block (5 item rows, each with yes/maybe/no + note); a sticky footer with autosave
     status ("Saved just now") and a big **Save report** button.
   - **Reactions:** big pill buttons, multi-select, tap to toggle, obvious active state.
   - **Buy signal:** three segmented buttons per item (green yes / amber maybe / red no).
   - **Autosave draft** to `localStorage` on change; restore on mount; clear on server save.
   - **Past reports:** cards showing parent name, role, date, a one-line summary
     (e.g. buy-signal tally + first ⭐ quote); click to reopen read-only or reload as draft.
4. **Dashboard tile** — add the Feedback card to the grid in `admin/page.tsx`.
5. **Verify** — `npm run build` clean; load `/admin/feedback` locally, run a fake call end
   to end (fill some, skip some, react, refresh to prove draft restore, save, see it in the
   list). Confirm the API 403s without an admin session.

## Nice-to-haves (only if time; note as TODO otherwise)
- Export a report to Markdown / copy-to-clipboard for pasting into a doc.
- Aggregate view: across all calls, tally buy-signal per item + most-reacted questions.
- Keyboard shortcuts for reactions (1–5) for the truly fast typist.
