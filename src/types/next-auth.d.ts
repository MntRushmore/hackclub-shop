import 'next-auth';

declare module 'next-auth' {
    interface Session {
        user: {
            id?: string;
            name?: string | null;
            email?: string | null;
            image?: string | null;
            slackId?: string;
        };
    }

    interface Profile {
        sub: string;
        name?: string;
        preferred_username?: string;
        email?: string;
        picture?: string;
        slack_id?: string;
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        accessToken?: string;
        id?: string;
        slackId?: string;
    }
}
