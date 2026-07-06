import React from "react";
import Link from "next/link";
import Image from "next/image";
import HeroDoodleGlow from "./HeroDoodleGlow";

/**
 * The storefront hero: words on the left, a vertical photo marquee on the
 * right (two columns scrolling opposite directions). The red blueprint-doodle
 * sits faintly behind the words and brightens around the cursor.
 *
 * The marquee is pure CSS (see globals.css → hc-marquee-up/down); it pauses on
 * hover and freezes under prefers-reduced-motion. Swap PHOTOS for product /
 * lifestyle shots later — the framing stays the same.
 */

const PHOTOS = Array.from({ length: 8 }, (_, i) => `/images/hc/photo${i + 1}.webp`);

function PhotoFrame({ src, tilt }: { src: string; tilt: number }) {
  return (
    <div
      className="bg-white p-2 rounded-[12px] shadow-[0_10px_30px_rgba(23,23,29,0.16)] ring-1 ring-black/[0.04]"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="relative w-full aspect-[4/3] overflow-hidden rounded-[6px] bg-hackclub-smoke">
        <Image src={src} alt="" fill className="object-cover" sizes="300px" draggable={false} />
      </div>
    </div>
  );
}

// Below lg the vertical marquee is hidden (too tall for a phone), so the hero
// would otherwise be headline-on-white. This compact horizontal strip brings
// the community photos back on mobile, bleeding off both edges with a side fade.
function MobilePhotoStrip() {
  const shots = [PHOTOS[1], PHOTOS[3], PHOTOS[4], PHOTOS[6]];
  return (
    <div
      className="lg:hidden mt-10 -mx-4 sm:-mx-6"
      aria-hidden="true"
      style={{
        maskImage: "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)",
        WebkitMaskImage: "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)",
      }}
    >
      <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {shots.map((src, i) => (
          <div key={src} className="shrink-0 w-40 sm:w-48">
            <PhotoFrame src={src} tilt={i % 2 ? 2 : -2} />
          </div>
        ))}
      </div>
    </div>
  );
}

function VColumn({ photos, dir, dur }: { photos: string[]; dir: "up" | "down"; dur: number }) {
  // Duplicate the set so the -50% translate loops seamlessly.
  const doubled = [...photos, ...photos];
  return (
    <div className="hc-vmarquee overflow-hidden h-full">
      <div
        className="hc-vtrack gap-4"
        style={{ animation: `${dir === "up" ? "hc-marquee-up" : "hc-marquee-down"} ${dur}s linear infinite` }}
      >
        {doubled.map((src, i) => (
          <div key={`${src}-${i}`} className="px-1">
            <PhotoFrame src={src} tilt={i % 2 ? 2 : -2} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HeroSplit() {
  return (
    <section className="relative overflow-hidden bg-white flex items-center min-h-[calc(100vh-64px)]">
      <HeroDoodleGlow src="/images/hc/doodle-bg.webp" />

      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* LEFT — the words */}
          <div className="text-center lg:text-left">
            <Image
              src="/images/hack-club-shop-wordmark.png"
              alt="Hack Club Shop"
              width={1871}
              height={612}
              priority
              className="h-12 sm:h-14 w-auto mb-6 mx-auto lg:mx-0"
            />
            <h1
              className="font-sans font-black text-hackclub-dark leading-[0.95] mb-6 text-[clamp(48px,6.5vw,84px)]"
              style={{ letterSpacing: "-0.02em" }}
            >
              You raised a <span className="text-hackclub-red">Hack&nbsp;Clubber.</span>
            </h1>
            <p className="text-xl sm:text-2xl text-hackclub-slate max-w-xl mx-auto lg:mx-0 mb-9 leading-relaxed">
              Back them with a donation, and wear the proof. Every tier funds
              the teenagers who build, ship, and dream at Hack Club.
            </p>
            <div className="flex flex-wrap gap-3 justify-center lg:justify-start items-center">
              <Link
                href="/shop"
                className="group inline-flex items-center gap-2 font-bold text-lg text-white px-9 py-4 rounded-full shadow-hc-card transition-all duration-150 ease-in-out hover:scale-[1.0625] hover:shadow-hc-elevated"
                style={{ backgroundImage: "radial-gradient(ellipse farthest-corner at top left, #ff8c37, #ec3750)" }}
              >
                <span>Back a teenager</span>
                <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
              </Link>
              <span className="text-hackclub-muted font-bold text-sm">
                501(c)(3) nonprofit · tax-deductible above the gift&apos;s value
              </span>
            </div>

            {/* Mobile-only photo strip (vertical marquee is lg+ only). */}
            <MobilePhotoStrip />
          </div>

          {/* RIGHT — two photo columns scrolling opposite directions, clipped to
              a tall window with a top/bottom fade so they bleed off naturally. */}
          <div
            className="hidden lg:grid grid-cols-2 gap-4 h-[78vh] max-h-[640px]"
            style={{
              maskImage: "linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)",
            }}
          >
            <VColumn photos={[PHOTOS[0], PHOTOS[2], PHOTOS[4], PHOTOS[6]]} dir="up" dur={40} />
            <VColumn photos={[PHOTOS[1], PHOTOS[3], PHOTOS[5], PHOTOS[7]]} dir="down" dur={48} />
          </div>
        </div>
      </div>
    </section>
  );
}
