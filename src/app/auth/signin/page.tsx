'use client';

import { signIn } from 'next-auth/react';
import Image from 'next/image';

export default function SignInPage() {
    return (
        <div
            className="min-h-screen flex items-center justify-center"
            style={{
                backgroundImage: `
                    linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                    linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4">
                <div className="text-center mb-8">
                    <Image
                        src="https://assets.hackclub.com/flag-standalone.svg"
                        alt="Hack Club"
                        width={60}
                        height={60}
                        className="mx-auto mb-4"
                    />
                    <h1 className="text-3xl font-black text-hackclub-dark mb-2">
                        Sign in to Shop
                    </h1>
                    <p className="text-hackclub-slate font-bold">
                        Use your Hack Club account to access credits and order history
                    </p>
                </div>

                <button
                    onClick={() => signIn('hackclub', { callbackUrl: '/' })}
                    className="w-full flex items-center justify-center gap-3 bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg px-6 py-4 rounded-full transition-all shadow-md hover:shadow-lg hover:scale-105 transform"
                >
                    <Image
                        src="https://assets.hackclub.com/flag-standalone.svg"
                        alt=""
                        width={24}
                        height={24}
                        className="invert"
                    />
                    Continue with Hack Club
                </button>

                <p className="text-center text-sm text-hackclub-muted mt-6">
                    Don&apos;t have an account?{' '}
                    <a
                        href="https://hackclub.com/slack"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-hackclub-blue hover:underline font-bold"
                    >
                        Join Hack Club
                    </a>
                </p>
            </div>
        </div>
    );
}
