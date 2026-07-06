import React from 'react';
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { getDonorWall, getImpactStats } from '../../lib/donorWall';
import { getDonationFund, DONATION_FUNDS } from '../../lib/donation';

/**
 * Public donor wall (donation pivot, Slice 3). Read-only: entries are written
 * exclusively by the Stripe webhook when a donation settles. Anonymous donors
 * appear as "Anonymous {tier}" with no name/dedication. The Redis reads are
 * wrapped in unstable_cache (the Upstash client's fetches are no-store, which
 * would force per-view reads) so a new donation shows up within a minute while
 * pageviews stay cheap.
 */
const getCachedWall = unstable_cache(
    async () => {
        const [entries, impact] = await Promise.all([getDonorWall(), getImpactStats()]);
        return { entries, impact };
    },
    ['donor-wall'],
    { revalidate: 60 },
);

export const metadata = {
    title: 'Donor Wall · Hack Club Shop',
    description: 'The families and friends backing teenagers at Hack Club.',
};

const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default async function DonorsPage() {
    const { entries, impact } = await getCachedWall();

    // Totals only. No derived "N laptops funded" claims: fund picks are donor
    // preferences, not earmarks (FINANCE_QUESTIONS.md Q5).
    const stats: { value: string; label: string }[] = [
        { value: dollars(impact.totalAmount), label: 'raised for teenagers' },
        { value: String(impact.totalCount), label: impact.totalCount === 1 ? 'donation' : 'donations' },
    ];

    return (
        <div className="min-h-screen bg-white font-sans">
            {/* Header on the dark band, matching the homepage's cause section. */}
            <section className="bg-hackclub-dark text-white pt-16 sm:pt-24 pb-16 sm:pb-20">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
                    <p className="text-xs font-black uppercase tracking-widest text-hackclub-red mb-4">Donor wall</p>
                    <h1 className="font-sans font-black leading-[1.05] mb-5" style={{ fontSize: 'clamp(36px, 6vw, 60px)', letterSpacing: '-0.02em' }}>
                        The people backing them
                    </h1>
                    <p className="text-xl text-white/80 max-w-2xl mx-auto leading-relaxed">
                        Every name here is a donation that funds a teenager who builds.
                        Thank you.
                    </p>
                    {impact.totalCount > 0 && (
                        <div className="mt-10 flex flex-wrap justify-center gap-x-12 gap-y-6">
                            {stats.map((s) => (
                                <div key={s.label}>
                                    <p className="text-4xl font-black text-white">{s.value}</p>
                                    <p className="text-sm font-bold text-white/60 mt-1">{s.label}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
                {entries.length === 0 ? (
                    <div className="text-center py-16">
                        <h2 className="text-2xl font-black text-hackclub-dark mb-3">The wall is waiting for its first name.</h2>
                        <p className="text-hackclub-slate font-medium mb-8">Back a teenager and it can be yours. Or stay anonymous, that works too.</p>
                        <Link
                            href="/shop"
                            className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-black px-8 py-3.5 rounded-full transition-colors"
                        >
                            Back a teenager →
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {entries.map((e, i) => (
                            <div
                                key={`${e.donatedAt}_${i}`}
                                className="bg-white rounded-2xl border-2 border-gray-200 p-6 shadow-md flex flex-col gap-2"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-hackclub-red/10 text-hackclub-red uppercase tracking-wide">
                                        {e.tier}
                                    </span>
                                    {e.vestNumber !== undefined && (
                                        <span className="text-xs font-black text-hackclub-muted">
                                            Vest #{String(e.vestNumber).padStart(3, '0')}
                                        </span>
                                    )}
                                </div>
                                <p className="text-lg font-black text-hackclub-dark">
                                    {e.displayName || `Anonymous ${e.tier}`}
                                </p>
                                {e.dedication && (
                                    <p className="text-hackclub-slate font-medium italic">&ldquo;{e.dedication}&rdquo;</p>
                                )}
                                <p className="text-sm font-bold text-hackclub-muted mt-auto pt-1">
                                    {getDonationFund(e.fundId).name}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {entries.length > 0 && (
                    <div className="text-center mt-14">
                        <p className="text-hackclub-slate font-medium mb-5">Your family&apos;s name belongs up here.</p>
                        <Link
                            href="/shop"
                            className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-black px-8 py-3.5 rounded-full transition-colors"
                        >
                            Back a teenager →
                        </Link>
                    </div>
                )}

                {/* Fund legend so the wall doubles as a pitch for directed giving. */}
                <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {DONATION_FUNDS.filter((f) => f.id !== 'general').map((f) => (
                        <div key={f.id} className="rounded-2xl bg-hackclub-smoke/60 border border-black/[0.06] p-5">
                            <p className="font-black text-hackclub-dark">{f.name}</p>
                            <p className="text-sm text-hackclub-slate font-medium mt-1">{f.description}</p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
