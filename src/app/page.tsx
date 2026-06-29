import React from "react";
import Link from "next/link";
import Image from "next/image";
import HeroSplit from "./components/HeroSplit";

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
        Every dollar supports teenagers at Hack Club, funding hackathons,
        coding clubs, and free programs that help young people build real
        things. You&apos;re not buying a sticker; you&apos;re backing a kid who
        makes.
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
    q: "Is my purchase tax-deductible?",
    a: (
      <>
        Hack Club is a registered 501(c)(3) nonprofit (EIN 81-2908499).
        Purchases support our programs; for the deductible portion of any gift,
        keep your receipt and check with your tax advisor.
      </>
    ),
  },
  {
    q: "What will I receive?",
    a: (
      <>
        Real merch: apparel and goods designed for the people who love a Hack
        Clubber. Everything ships to your door. You&apos;ll get an order
        confirmation by email and tracking when it&apos;s on the way.
      </>
    ),
  },
];

const MainPage = () => {
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
            Somewhere right now, your kid is up too late, deep in a project
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
            This shop exists so the people who love them can say it out loud,
            and put every dollar back into the next thing they build.
          </p>
        </div>
      </section>

      {/* ── WHERE THE MONEY GOES (dark, doodle-tinted) ───────────────────── */}
      <section className="relative bg-hackclub-dark text-white py-20 sm:py-28 overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-[0.12]">
          <Image src="/images/hc/doodle-bg.webp" alt="" fill className="object-cover object-center" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-sans font-black mb-5 leading-[1.05]" style={{ fontSize: "clamp(32px, 5.5vw, 52px)", letterSpacing: "-0.02em" }}>
            All proceeds support teenagers at Hack Club
          </h2>
          <p className="text-xl text-white/80 max-w-2xl mx-auto mb-14 leading-relaxed">
            We&apos;re a 501(c)(3) nonprofit. What you spend here doesn&apos;t go
            to a corporation. It goes to young makers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            {[
              { title: "Hackathons", body: "Weekend-long events where teenagers build real projects with real mentors, most of them free to attend.", photo: "/images/hc/photo2.webp" },
              { title: "Clubs", body: "Coding clubs in high schools around the world, with the curriculum and support to keep them running.", photo: "/images/hc/photo4.webp" },
              { title: "Free programs", body: "Tools, hardware, and programs that put making within reach of any teenager who wants it.", photo: "/images/hc/photo7.webp" },
            ].map((c) => (
              <div key={c.title} className="bg-white/[0.06] rounded-2xl border border-white/10 backdrop-blur-sm overflow-hidden flex flex-col">
                <div className="relative aspect-[16/10] w-full">
                  <Image src={c.photo} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
                <div className="p-7">
                  <h3 className="text-xl font-bold text-hackclub-red mb-2">{c.title}</h3>
                  <p className="text-white/75 leading-relaxed">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <h2 className="font-sans font-black text-hackclub-dark mb-10 text-center leading-[1.05]"
            style={{ fontSize: "clamp(32px, 5.5vw, 52px)", letterSpacing: "-0.02em" }}>
          Questions parents ask
        </h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <details key={item.q} className="group bg-white rounded-2xl shadow-hc-card overflow-hidden">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-6 py-5 font-bold text-lg text-hackclub-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hackclub-red/40 rounded-2xl">
                {item.q}
                <span className="text-hackclub-red text-2xl leading-none transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="px-6 pb-6 -mt-1 text-hackclub-slate text-lg leading-relaxed">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
        <div
          className="relative rounded-3xl px-8 py-16 sm:py-20 text-center overflow-hidden"
          style={{ backgroundImage: "radial-gradient(ellipse farthest-corner at top left, #ff8c37, #ec3750)" }}
        >
          <h2 className="font-sans font-black text-white mb-4 leading-[1.05]" style={{ fontSize: "clamp(30px, 5vw, 48px)", letterSpacing: "-0.02em" }}>
            Show the world you&apos;re proud.
          </h2>
          <p className="text-xl text-white/90 max-w-xl mx-auto mb-8 leading-relaxed">
            Find something for the maker in your life, and back the next thing they build.
          </p>
          <Link
            href="/shop"
            className="group inline-flex items-center gap-2 bg-white hover:bg-hackclub-smoke text-hackclub-red font-bold text-lg px-9 py-4 rounded-full shadow-hc-card transition-all duration-150 ease-in-out hover:scale-[1.0625] hover:shadow-hc-elevated"
          >
            <span>Shop the collection</span>
            <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
          </Link>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="bg-black text-white py-12 relative"
        style={{
          backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center space-y-3">
            <p className="text-lg font-bold flex items-center justify-center gap-1">
              made with{" "}
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
              </svg>
              {" "}by teenagers
            </p>
            <div className="flex flex-wrap justify-center items-center gap-x-3 text-sm">
              <a href="https://hackclub.com/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">hack club</a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/slack/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">slack</a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/clubs/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">clubs</a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/hackathons/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">hackathons</a>
              <span className="text-hackclub-muted">|</span>
              <a href="mailto:shop@hackclub.com" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors">shop@hackclub.com</a>
            </div>
            <p className="text-hackclub-muted text-sm">© 2026 Hack Club · 501(c)(3) nonprofit (EIN: 81-2908499)</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MainPage;
