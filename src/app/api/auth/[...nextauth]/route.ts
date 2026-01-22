import NextAuth, { NextAuthOptions } from 'next-auth';

if (!process.env.HACKCLUB_CLIENT_ID || !process.env.HACKCLUB_CLIENT_SECRET) {
    throw new Error('Hack Club Auth env vars are missing');
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
                console.log('[auth] Profile from provider:', profile);
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
                                console.log('[auth] Using Hack Club identity ID:', meData.identity.id);
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
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.name = token.name as string;
                session.user.email = token.email as string;
                const userId = (token.slackId as string) || (token.id as string);
                (session.user as { id?: string }).id = userId;
                console.log('[auth] Session user ID:', userId, 'slack_id:', token.slackId, 'identity_id:', token.id);
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

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
