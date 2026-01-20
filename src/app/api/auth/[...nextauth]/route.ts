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
                    scope: 'openid profile email slack_id',
                },
            },
            client: {
                token_endpoint_auth_method: 'client_secret_basic',
            },
            clientId: process.env.HACKCLUB_CLIENT_ID,
            clientSecret: process.env.HACKCLUB_CLIENT_SECRET,
            idToken: true,
            checks: ['pkce', 'state'],
            profile(profile) {
                return {
                    id: profile.sub,
                    name: profile.name || profile.preferred_username,
                    email: profile.email,
                    image: profile.picture,
                    slackId: profile.slack_id,
                };
            },
        },
    ],
    callbacks: {
        async jwt({ token, account, profile }) {
            if (account && profile) {
                token.accessToken = account.access_token;
                token.id = profile.sub;
                token.slackId = (profile as { slack_id?: string }).slack_id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as { id?: string }).id = token.id as string;
                (session.user as { slackId?: string }).slackId = token.slackId as string;
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
