import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { normalizeShareTier, normalizeShareNumber, shareHeadline, shareSubline } from '../../lib/shareCard';

/**
 * The landing page behind a donor's share ("We hold vest #042 of 100") — donation
 * pivot, Slice 4. Its job is the OG card in the feed and one CTA for the
 * friend who clicked: back a teenager too. Query params are validated against
 * the shareCard allowlists, so arbitrary text can never be injected into the
 * page or the OG image.
 */

type Search = { t?: string; n?: string };

export function generateMetadata({ searchParams }: { searchParams: Search }): Metadata {
    const tier = normalizeShareTier(searchParams.t);
    const num = normalizeShareNumber(searchParams.n);
    const title = `${shareHeadline(tier, num)} · Hack Club`;
    const description = shareSubline();
    const og = `/api/og/backed?${new URLSearchParams({
        ...(tier ? { t: tier } : {}),
        ...(num ? { n: String(num) } : {}),
    }).toString()}`;
    return {
        title,
        description,
        openGraph: { title, description, images: [{ url: og, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [og] },
    };
}

export default function BackedPage({ searchParams }: { searchParams: Search }) {
    const tier = normalizeShareTier(searchParams.t);
    const num = normalizeShareNumber(searchParams.n);

    return (
        <div className="min-h-screen bg-hackclub-dark text-white flex flex-col items-center justify-center text-center px-4 py-20">
            {tier && (
                <p className="px-4 py-1.5 rounded-full bg-hackclub-red text-white text-sm font-black uppercase tracking-widest mb-6">
                    {tier}
                </p>
            )}
            <h1 className="font-black leading-[1.02] mb-6" style={{ fontSize: 'clamp(40px, 7vw, 76px)', letterSpacing: '-0.02em' }}>
                {shareHeadline(tier, num)}
            </h1>
            <p className="text-xl text-white/80 max-w-xl leading-relaxed mb-10">
                {shareSubline()} Donate at a tier and the merch is the thank-you.
                Hack Club is a 501(c)(3), so most of the donation is tax-deductible.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                    href="/shop"
                    className="inline-flex items-center gap-2 font-bold text-lg text-white px-9 py-4 rounded-full transition-transform hover:scale-[1.05]"
                    style={{ backgroundImage: 'radial-gradient(ellipse farthest-corner at top left, #ff8c37, #ec3750)' }}
                >
                    Back a teenager →
                </Link>
                <Link
                    href="/donors"
                    className="inline-flex items-center gap-2 font-bold text-lg text-white/80 hover:text-white px-7 py-4 rounded-full border-2 border-white/20 hover:border-white/50 transition-colors"
                >
                    See the donor wall
                </Link>
            </div>
        </div>
    );
}
