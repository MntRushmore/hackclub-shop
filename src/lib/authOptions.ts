import { NextAuthOptions } from 'next-auth';
import { Redis } from '@upstash/redis';

// NextAuth configuration. Lives in lib/ (not the route file) because Next 14+
// route modules may only export route handlers + a small allowlist of fields —
// exporting `authOptions` from the route itself is a build error. Every caller
// that needs the session config imports it from here.

if (!process.env.HACKCLUB_CLIENT_ID || !process.env.HACKCLUB_CLIENT_SECRET) {
    throw new Error('Hack Club Auth env vars are missing');
}

// next-auth v4 only enforces a secret in production; without this guard a
// misconfigured non-prod deploy would sign session JWTs with a predictable
// auto-derived secret, allowing session forgery. Require it everywhere.
if (!process.env.NEXTAUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET is required to sign session tokens');
}

// Persist identity (name/email) so the admin user list can show who's who —
// the points/orders keys are keyed only by id, and slackId is the only other
// thing we'd previously stored. Best-effort; never blocks login.
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

async function persistIdentity(token: { id?: unknown; slackId?: unknown; name?: unknown; email?: unknown }) {
    const userId = (token.slackId as string) || (token.id as string);
    if (!userId) return;
    try {
        const writes: Promise<unknown>[] = [];
        if (token.name) writes.push(redis.set(`user:${userId}:name`, token.name as string));
        if (token.email) writes.push(redis.set(`user:${userId}:email`, token.email as string));
        if (token.slackId) writes.push(redis.set(`user:${userId}:slackId`, token.slackId as string));
        await Promise.all(writes);
    } catch (error) {
        console.error('Failed to persist user identity:', error);
    }
}

export const authOptions: NextAuthOptions = {
    providers: [
        {
            id: 'hackclub',
            name: 'Hack Club',
            type: 'oauth',
            wellKnown: 'https://auth.hackclub.com/.well-known/openid-configuration',
            authorization: {
                params: {
                    scope: 'openid profile email name slack_id',
                },
            },
            client: {
                token_endpoint_auth_method: 'client_secret_basic',
            },
            clientId: process.env.HACKCLUB_CLIENT_ID,
            clientSecret: process.env.HACKCLUB_CLIENT_SECRET,
            idToken: true,
            checks: ['pkce', 'state'],
            profile(profile: any) {
                return {
                    id: profile.sub,
                };
            },
        },
    ],
    callbacks: {
        async jwt({ token, account, profile }) {
            if (account && profile) {
                token.accessToken = account.access_token;
                token.id = profile.sub;

                if (account.access_token) {
                    try {
                        const meResponse = await fetch('https://auth.hackclub.com/api/v1/me', {
                            headers: {
                                'Authorization': `Bearer ${account.access_token}`,
                            },
                        });
                        const meData = await meResponse.json();
                        if (meData.identity) {
                            token.name = `${meData.identity.first_name} ${meData.identity.last_name}`;
                            token.email = meData.identity.primary_email;
                            token.slackId = meData.identity.slack_id;
                            if (meData.identity.id) {
                                token.id = meData.identity.id;
                            }

                            if (meData.identity.slack_id && process.env.SLACK_BOT_TOKEN) {
                                try {
                                    const slackResponse = await fetch('https://slack.com/api/users.info', {
                                        method: 'POST',
                                        headers: {
                                            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                                            'Content-Type': 'application/x-www-form-urlencoded',
                                        },
                                        body: `user=${meData.identity.slack_id}`,
                                    });
                                    const slackData = await slackResponse.json();
                                    if (slackData.ok && slackData.user?.profile?.image_512) {
                                        token.image = slackData.user.profile.image_512;
                                    } else {
                                        token.image = (profile as any).picture || (profile as any).image;
                                    }
                                } catch (error) {
                                    console.error('Failed to fetch Slack profile:', error);
                                    token.image = (profile as any).picture || (profile as any).image;
                                }
                            } else {
                                token.image = (profile as any).picture || (profile as any).image;
                            }
                        }
                    } catch (error) {
                        console.error('Failed to fetch user info in JWT callback:', error);
                        token.image = (profile as any).picture || (profile as any).image;
                    }
                } else {
                    token.image = (profile as any).picture || (profile as any).image;
                }

                // Backfill the admin-visible identity on each fresh login.
                await persistIdentity(token);
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.name = token.name as string;
                session.user.email = token.email as string;
                const userId = (token.slackId as string) || (token.id as string);
                (session.user as { id?: string }).id = userId;
                (session.user as { slackId?: string }).slackId = token.slackId as string;
                (session.user as { identityId?: string }).identityId = token.id as string;
                (session.user as { image?: string }).image = (token.image || token.picture) as string;
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
    },
    secret: process.env.NEXTAUTH_SECRET,
};
