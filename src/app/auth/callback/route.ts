import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    // Forward to NextAuth's callback handler
    const callbackUrl = new URL('/api/auth/callback/hackclub', request.url);
    if (code) callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    redirect(callbackUrl.toString());
}
