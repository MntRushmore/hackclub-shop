import React from "react";
import Link from "next/link";
import Image from "next/image";

/**
 * The hackclub.com footer, rebuilt for the shop: the same dark grid-line band,
 * brand column (HC flag + "For teens, by teens." + socials), the signature
 * mascot illustration bleeding off the top-right, and multi-column links — but
 * the columns carry SHOP destinations (Browse, Track order, contact) alongside
 * the real Hack Club links. Bottom line keeps the true 501(c)(3) registration.
 *
 * Built in Tailwind (our stack) rather than the site's inline styles; colors
 * mapped to our palette (dark band, paper-white text at 80% opacity).
 */

const shopLinks = [
  { label: "Browse the shop", href: "/shop" },
  { label: "Track your order", href: "/orders/track" },
  { label: "Your orders", href: "/orders" },
  { label: "Contact us", href: "mailto:shop@hackclub.com" },
];

const hcLinks = [
  { label: "What is Hack Club?", href: "https://hackclub.com/" },
  { label: "Clubs", href: "https://hackclub.com/clubs/" },
  { label: "Hackathons", href: "https://hackclub.com/hackathons/" },
  { label: "Slack community", href: "https://hackclub.com/slack/" },
  { label: "Donate", href: "https://hackclub.com/philanthropy/" },
];

function isExternal(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:");
}

function FooterLink({ label, href }: { label: string; href: string }) {
  const cls =
    "text-white/80 hover:text-white focus-visible:text-white transition-opacity text-base outline-none";
  return isExternal(href) ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noopener noreferrer" : undefined} className={cls}>
      {label}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

function LinkCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="min-w-[150px]">
      <p className="font-bold text-xl text-white mb-4 leading-tight">{title}</p>
      <ul className="list-none p-0 m-0 flex flex-col gap-3.5">
        {links.map((l) => (
          <li key={l.label}>
            <FooterLink {...l} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOCIALS = [
  { label: "GitHub", href: "https://github.com/hackclub", d: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" },
  { label: "YouTube", href: "https://www.youtube.com/c/HackClubHQ", d: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
  { label: "Instagram", href: "https://www.instagram.com/starthackclub", d: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
  { label: "Email", href: "mailto:shop@hackclub.com", d: "M0 3v18h24V3H0zm21.518 2L12 12.713 2.482 5h19.036zM2 19V7.183l10 8.104 10-8.104V19H2z" },
];

export default function HCFooter() {
  return (
    <footer
      className="relative overflow-hidden text-white pt-16 pb-14 px-6 sm:px-10 lg:px-20 mt-px"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(#17171d, #17171d)",
        backgroundSize: "50px 50px, 50px 50px, 100% 100%",
      }}
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-start gap-x-16 gap-y-12 mb-16 relative z-10">
        {/* Brand column */}
        <div className="flex flex-col w-[260px] shrink-0">
          <Link href="/" className="mb-7 inline-block">
            <Image src="/images/hc/hack-club-flag.svg" alt="Hack Club" width={200} height={70} className="block object-contain" />
          </Link>
          <p className="text-xl text-white m-0 mb-2 leading-tight">For teens, by teens.</p>
          <a
            href="tel:18556254225"
            aria-label="Call Hack Club toll-free at 1-855-625-4225"
            className="text-xl text-white/80 m-0 mb-8 leading-tight no-underline inline-block hover:text-white transition-opacity"
          >
            1-855-625-HACK (call toll-free)
          </a>
          <div className="flex gap-2">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target={s.href.startsWith("http") ? "_blank" : undefined}
                rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
                aria-label={s.label}
                className="flex items-center justify-center w-11 h-11 rounded-lg text-white/80 hover:text-white transition-opacity outline-none focus-visible:text-white"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d={s.d} />
                </svg>
              </a>
            ))}
          </div>
        </div>

        {/* Link columns */}
        <div className="flex gap-12 sm:gap-16 flex-wrap">
          <LinkCol title="Shop" links={shopLinks} />
          <LinkCol title="Hack Club" links={hcLinks} />
        </div>
      </div>

      {/* Bottom legal line — the real Hack Foundation / 501(c)(3) registration. */}
      <div className="max-w-6xl mx-auto pt-8 border-t border-white/10 relative z-10">
        <p className="text-base text-white/80 m-0 leading-relaxed">
          © {new Date().getFullYear()} Hack Club. Registered under{" "}
          <a href="https://the.hackfoundation.org/" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-2">
            The Hack Foundation
          </a>
          , a 501(c)(3) nonprofit (EIN: 81-2908499). Made with{" "}
          <span aria-label="love" className="text-hackclub-red">♥</span> by teenagers.
        </p>
      </div>
    </footer>
  );
}
