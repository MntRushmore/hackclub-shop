"use client";

import React, { useRef, useState } from "react";

/**
 * Footer easter egg. The ♥ in "Made with ♥ by teenagers" looks like plain
 * text until you hover it: the heart starts beating (an actual lub-dub
 * cardiac rhythm, not a generic pulse) and a tiny terminal-style code
 * comment pops up crediting the developer, blinking cursor included.
 *
 * The bubble stays open for a grace period after the pointer leaves so you
 * can travel up into it and click the GitHub link. Tapping the heart
 * toggles it on touch screens, where hover doesn't exist.
 */
export default function FooterHeart() {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 300);
  };

  return (
    <span
      className="relative inline-block align-baseline"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <style>{`
        @keyframes hc-heartbeat {
          0%   { transform: scale(1); }
          14%  { transform: scale(1.35); }
          28%  { transform: scale(1); }
          42%  { transform: scale(1.25); }
          56%  { transform: scale(1); }
          100% { transform: scale(1); }
        }
        @keyframes hc-bubble-pop {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.7); }
          60%  { opacity: 1; transform: translateX(-50%) translateY(-2px) scale(1.06); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes hc-caret-blink {
          0%, 49%  { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .hc-heart-beating {
          animation: hc-heartbeat 1.1s ease-in-out infinite;
        }
      `}</style>

      <button
        type="button"
        aria-label="love"
        aria-expanded={open}
        onClick={() => (open ? hide() : show())}
        onFocus={show}
        onBlur={hide}
        className={`text-hackclub-red inline-block cursor-default select-none bg-transparent border-0 p-0 m-0 outline-none ${
          open ? "hc-heart-beating" : ""
        }`}
        style={{ font: "inherit" }}
      >
        ♥
      </button>

      {open && (
        <span
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          className="absolute bottom-full left-1/2 mb-3 z-50 whitespace-nowrap rounded-lg border border-white/15 bg-[#26262e] px-3.5 py-2 font-mono text-sm text-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          style={{ animation: "hc-bubble-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
        >
          <span className="text-white/40">{"// "}</span>
          developed by{" "}
          <a
            href="https://github.com/MntRushmore/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-hackclub-red underline underline-offset-2 hover:text-white transition-colors"
          >
            Rushil
          </a>
          <span
            aria-hidden="true"
            className="ml-1 inline-block w-[7px] h-[1em] translate-y-[2px] bg-white/70"
            style={{ animation: "hc-caret-blink 1s step-end infinite" }}
          />
          {/* speech-bubble tail */}
          <span
            aria-hidden="true"
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-x-8 border-x-transparent border-t-8 border-t-[#26262e]"
          />
        </span>
      )}
    </span>
  );
}
