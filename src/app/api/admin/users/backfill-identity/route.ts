import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../../lib/adminAuth';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * One-time (re-runnable, idempotent) backfill of name/email into Redis for users
 * who existed before login started persisting those fields. Admin-only. POST to run.
 *
 * Source of truth is the Slack API (users.info) — the user key IS the Slack id,
 * and the login flow already uses this exact call. real_name + profile.email cover
 * both fields without depending on the Airtable mirror being populated.
 *
 * Gap-fill only: a value that login has already written is never overwritten, so
 * re-running is safe and can't clobber fresher data.
 */
export async function POST() {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!process.env.SLACK_BOT_TOKEN) {
        return NextResponse.json(
            { error: 'Slack is not configured (missing SLACK_BOT_TOKEN).' },
            { status: 500 },
        );
    }

    // Slack's Tier 4 (users.info) allows ~100/min; ~3 req/sec keeps us well under.
    const throttle = () => new Promise((r) => setTimeout(r, 300));

    const counts = { scanned: 0, namesFilled: 0, emailsFilled: 0, skipped: 0, slackMisses: 0, errors: 0 };

    try {
        // Distinct user ids from the same key patterns the admin list uses.
        const userIds = new Set<string>();
        for (const pattern of ['user:*:pointsBalance', 'user:*:orders']) {
            const keys = await redis.keys(pattern);
            for (const k of keys) userIds.add(k.split(':')[1]);
        }

        for (const userId of userIds) {
            counts.scanned++;

            const [existingName, existingEmail] = await Promise.all([
                redis.get<string>(`user:${userId}:name`),
                redis.get<string>(`user:${userId}:email`),
            ]);

            // Nothing to do if login already populated both.
            if (existingName && existingEmail) {
                counts.skipped++;
                continue;
            }

            // The user key is the Slack id; ask Slack for the canonical profile.
            let slackUser: { real_name?: string; profile?: { real_name?: string; email?: string } } | null = null;
            try {
                const res = await fetch('https://slack.com/api/users.info', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: `user=${encodeURIComponent(userId)}`,
                });
                const data = await res.json();
                if (data.ok && data.user) {
                    slackUser = data.user;
                } else {
                    // Not a Slack id we can resolve (e.g. an HC identity id) — skip cleanly.
                    counts.slackMisses++;
                }
            } catch (err) {
                console.error(`[Identity Backfill] Slack lookup failed for ${userId}:`, err);
                counts.errors++;
            }
            await throttle();

            if (!slackUser) continue;

            const name = slackUser.profile?.real_name || slackUser.real_name;
            const email = slackUser.profile?.email;

            const writes: Promise<unknown>[] = [];
            if (!existingName && name) {
                writes.push(redis.set(`user:${userId}:name`, name));
                counts.namesFilled++;
            }
            if (!existingEmail && email) {
                writes.push(redis.set(`user:${userId}:email`, email));
                counts.emailsFilled++;
            }
            if (writes.length) await Promise.all(writes);
        }

        return NextResponse.json({ ok: true, counts });
    } catch (error) {
        console.error('[Identity Backfill] Error:', error);
        counts.errors++;
        return NextResponse.json(
            { error: 'Backfill failed partway', counts, detail: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
