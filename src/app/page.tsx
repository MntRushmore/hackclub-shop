import React from "react";
import Link from "next/link";
import Image from "next/image";
import HeroSplit from "./components/HeroSplit";
import HCFooter from "./components/HCFooter";
import WaveDivider from "./components/WaveDivider";
import { unstable_cache } from "next/cache";
import { getImpactStats } from "../lib/donorWall";

// Live impact meters read Redis. The Upstash client's fetches are no-store
// (which would force this page dynamic), so the read is wrapped in
// unstable_cache: one Redis hit per 5 minutes, not per pageview.
const getCachedImpact = unstable_cache(() => getImpactStats(), ["homepage-impact"], { revalidate: 300 });

/**
 * Parent-facing storefront landing, built in the Hack Club design language:
 * a bold Phantom Sans headline with "Hack Clubber." in brand red, a faint
 * red blueprint-doodle background that brightens around the cursor, and a
 * full-bleed marquee of real Hack Clubber photos. Copy is parent-first
 * (pride → cause → FAQ).
 *
 * Assets (fonts, doodle bg, photos) are self-hosted under /public, pulled from
 * hackclub/site so the storefront doesn't depend on their deploy at runtime.
 */

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Where does my money go?",
    a: (
      <>
        Straight to teenagers at Hack Club. That looks like a laptop for a
        kid who needs one, travel to a first hackathon, or a gap year spent
        building something real. At checkout you can tell us what
        matters most to you, and we&apos;ll put every dollar where it helps
        teens most. You&apos;re not buying a mug; you&apos;re backing a kid who
        makes.
      </>
    ),
  },
  {
    q: "Why does a mug cost $100?",
    a: (
      <>
        It doesn&apos;t. The mug is free. The $100 is a donation to Hack Club,
        and the mug is how we say thank you. That&apos;s why a donation here
        does something an $18 mug never could: it puts real money behind a
        teenager&apos;s next project.
      </>
    ),
  },
  {
    q: "What is Hack Club?",
    a: (
      <>
        Hack Club is a global nonprofit network of high schoolers who code,
        build, and ship real projects together at hackathons, in clubs, and
        online. It&apos;s where curious teenagers go to become makers.
      </>
    ),
  },
  {
    q: "Is my donation tax-deductible?",
    a: (
      <>
        Yes. Hack Club is a registered 501(c)(3) nonprofit (EIN 81-2908499),
        and the portion of your donation above the fair market value of your
        thank-you gift is tax-deductible. Your emailed receipt doubles as the
        IRS acknowledgment, with the exact numbers on it. Many employers also
        match charitable donations, so it&apos;s worth a quick search of your
        company&apos;s matching portal.
      </>
    ),
  },
  {
    q: "What will I receive?",
    a: (
      <>
        Real merch as our thanks: apparel and goods designed for the people who
        love a Hack Clubber, all the way up to the numbered vest (only 100 will
        ever be made). Everything ships to your door with a confirmation email
        and tracking when it&apos;s on the way.
      </>
    ),
  },
];

const dollars = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const MainPage = async () => {
  // Live impact numbers (fail-soft to zeros; meters hide until money moves).
  // Meters show dollars raised toward each cause. No "N laptops funded" style
  // outcome claims: funds are donor preferences and the causes are examples of
  // where the money goes, not earmarked pledges (see FINANCE_QUESTIONS.md Q5).
  const impact = await getCachedImpact();
  const meterFor = (fundId: string): string | null => {
    const fund = impact.funds[fundId];
    if (!fund || fund.amount <= 0) return null;
    return `${dollars(fund.amount)} raised so far`;
  };

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* ── HERO: words left, vertical photo marquee right ──────────────── */}
      <HeroSplit />

      {/* ── THE STORY ────────────────────────────────────────────────────── */}
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <h2 className="font-sans font-black text-hackclub-dark text-center leading-[1.05] mb-8"
            style={{ fontSize: "clamp(34px, 6vw, 52px)", letterSpacing: "-0.02em" }}>
          The kid who can&apos;t stop building
        </h2>
        <div className="space-y-6 text-xl text-hackclub-slate leading-relaxed">
          <p>
            Somewhere right now, a kid is up too late, deep in a project
            nobody assigned them. A game. A website. A little robot. Something
            they decided the world should have, and then made.
          </p>
          <p>
            That&apos;s a Hack Clubber. Optimistic, a little stubborn,
            convinced they can build their way to a better thing. Hack Club is
            the community of teenagers around the world who feel exactly that
            way, and the hackathons, clubs, and tools that help them do it.
          </p>
          <p className="text-hackclub-dark font-bold">
            This shop is how the people who love them chip in: pick a
            product, take home the merch as our thanks, and put every dollar
            into the next thing they build.
          </p>
        </div>
      </section>

      {/* ── WHERE THE MONEY GOES (dark, doodle-tinted) ───────────────────── */}
      {/* Clean straight top edge into the dark band; the scallop wave lives only
          at the bottom of this section, where it flows into the calm FAQ band
          (a scallop here competed with the heavy headline + doodle below it). */}
      <section className="relative bg-hackclub-dark text-white pt-20 sm:pt-28 pb-20 sm:pb-28 overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-[0.12]">
          <Image src="/images/hc/doodle-bg.webp" alt="" fill className="object-cover object-center" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-sans font-black mb-5 leading-[1.05]" style={{ fontSize: "clamp(32px, 5.5vw, 52px)", letterSpacing: "-0.02em" }}>
            What your donation makes possible
          </h2>
          <p className="text-xl text-white/80 max-w-2xl mx-auto mb-14 leading-relaxed">
            We&apos;re a 501(c)(3) nonprofit, and every dollar goes to teenagers.
            Here&apos;s the kind of thing it can pay for. At checkout you can tell
            us which one matters most to you.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            {[
              { title: "Laptops", body: "A kid can't build much without a computer of their own. $500 can put a laptop in a teenager's hands.", photo: "/images/hc/photo2.webp", meter: meterFor("laptop") },
              { title: "First hackathons", body: "Travel help so a teen can meet their community in person. Sometimes a bus ticket is all that's in the way.", photo: "/images/hc/photo4.webp", meter: meterFor("first-hackathon") },
              { title: "Gap years & big projects", body: "Backing teenagers who take time to build something real, with tools, hardware, and grants.", photo: "/images/hc/photo7.webp", meter: meterFor("gap-year") },
            ].map((c) => (
              <div key={c.title} className="bg-white/[0.06] rounded-2xl border border-white/10 backdrop-blur-sm overflow-hidden flex flex-col">
                <div className="relative aspect-[16/10] w-full">
                  <Image src={c.photo} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
                <div className="p-7">
                  <h3 className="text-xl font-bold text-hackclub-red mb-2">{c.title}</h3>
                  <p className="text-white/75 leading-relaxed">{c.body}</p>
                  {c.meter && (
                    <p className="mt-4 text-sm font-black text-white/90 bg-white/[0.08] rounded-full px-3.5 py-1.5 inline-block">
                      {c.meter}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-12 text-white/80 font-bold">
            {impact.totalCount > 0 && (
              <span className="mr-2">{dollars(impact.totalAmount)} raised by {impact.totalCount} donor{impact.totalCount === 1 ? "" : "s"} so far.</span>
            )}
            <Link href="/donors" className="text-hackclub-red hover:text-hackclub-orange underline decoration-2 underline-offset-4 transition-colors">
              See the donor wall →
            </Link>
          </p>
        </div>
        {/* The smoke FAQ band rises into the dark section on the HC scallop wave. */}
        <WaveDivider color="#f9fafc" />
      </section>

      {/* ── THE THANK-YOU MERCH ──────────────────────────────────────────── */}
      {/* Product photos only (the tier pages carry the story): a shelf of the
          gifts a donation can come with, linking into the tier ladder. */}
      <section className="bg-hackclub-smoke pt-16 sm:pt-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-sans font-black text-hackclub-dark leading-[1.05]"
              style={{ fontSize: "clamp(32px, 5.5vw, 52px)", letterSpacing: "-0.02em" }}>
            The thank-you merch
          </h2>
          <p className="text-lg text-hackclub-slate mt-4 mb-10 max-w-xl mx-auto">
            Every product comes with a gift from this shelf. The bigger
            donations pick from more of it.
          </p>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-5">
            {[
              { name: "Sticker Pack", img: "/gifts/sticker.jpg" },
              { name: "Mug", img: "/gifts/mug.jpg" },
              { name: "Tote Bag", img: "/gifts/tote.jpg" },
              { name: "Tee", img: "/gifts/tee.jpg" },
              { name: "College Hoodie", img: "/gifts/hoodie.jpg" },
              { name: "Mom Hoodie", img: "/gifts/mom-sweatshirt.jpg" },
              { name: "Numbered Vest", img: "/gifts/vest.jpg" },
            ].map((m) => (
              <Link key={m.name} href="/shop" className="group w-32 sm:w-36">
                <div className="relative aspect-square rounded-2xl overflow-hidden border border-black/[0.06] shadow-hc-card bg-white transition-shadow duration-150 group-hover:shadow-hc-elevated">
                  <Image src={m.img} alt={m.name} fill className="object-cover transition-transform duration-200 group-hover:scale-105" sizes="144px" />
                </div>
                <p className="mt-2 text-sm font-bold text-hackclub-slate group-hover:text-hackclub-red transition-colors">{m.name}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      {/* Tinted background so the white cards actually read as cards (on a white
          page they were invisible — only the faint shadow hinted at them). */}
      <section className="bg-hackclub-smoke pt-16 sm:pt-20 pb-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-sans font-black text-hackclub-dark text-center leading-[1.05]"
              style={{ fontSize: "clamp(32px, 5.5vw, 52px)", letterSpacing: "-0.02em" }}>
            Questions parents ask
          </h2>
          <p className="text-lg text-hackclub-slate text-center mt-4 mb-12 max-w-xl mx-auto">
            The honest answers, up front. Still unsure? We&apos;re a real team and
            we read every email.
          </p>
          <div className="space-y-4">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group bg-white rounded-2xl border border-black/[0.06] shadow-hc-card overflow-hidden transition-shadow duration-150 hover:shadow-hc-elevated"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-6 sm:px-7 py-5 font-bold text-lg text-hackclub-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hackclub-red/40 rounded-2xl">
                  <span className="transition-colors group-hover:text-hackclub-red">{item.q}</span>
                  <span aria-hidden="true" className="flex-none grid place-items-center w-7 h-7 rounded-full bg-hackclub-red/10 text-hackclub-red text-xl leading-none transition-transform duration-200 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="px-6 sm:px-7 pb-6 -mt-1 text-hackclub-slate text-lg leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
          <p className="text-center text-hackclub-slate mt-10">
            Still have a question?{" "}
            <a href="mailto:shop@hackclub.com" className="font-bold text-hackclub-red hover:text-hackclub-orange underline decoration-2 underline-offset-2 transition-colors">
              shop@hackclub.com
            </a>
          </p>
        </div>

        {/* ── CLOSING CTA ──────────────────────────────────────────────── */}
        {/* Light, on the smoke band (no heavy gradient box): bold-sans headline
            in the page's voice, with the gradient living only in the button so
            it echoes the hero's CTA pill. */}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-24 sm:mt-32 text-center">
          <h2 className="font-sans font-black text-hackclub-dark mb-4 leading-[1.05]" style={{ fontSize: "clamp(30px, 5vw, 48px)", letterSpacing: "-0.02em" }}>
            Show the world you&apos;re proud.
          </h2>
          <p className="text-xl text-hackclub-slate max-w-xl mx-auto mb-9 leading-relaxed">
            Pick a product and back the next thing they build. The merch is on us.
          </p>
          <Link
            href="/shop"
            className="group inline-flex items-center gap-2 font-bold text-lg text-white px-9 py-4 rounded-full shadow-hc-card transition-all duration-150 ease-in-out hover:scale-[1.0625] hover:shadow-hc-elevated"
            style={{ backgroundImage: "radial-gradient(ellipse farthest-corner at top left, #ff8c37, #ec3750)" }}
          >
            <span>Back a teenager</span>
            <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
          </Link>
        </div>
      </section>

      {/* ── FOOTER (HC-style, shop content) ──────────────────────────────── */}
      <HCFooter />
    </div>
  );
};

export default MainPage;
