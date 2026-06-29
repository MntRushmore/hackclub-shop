"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * The hackclub.com hero "flashlight" effect: the red blueprint-doodle line-art
 * sits faint across the whole hero, and brightens in a soft radius around the
 * cursor — as if the pointer were a flashlight revealing it.
 *
 * Technique: two stacked copies of the doodle image.
 *  - A base layer at low opacity, always faintly visible.
 *  - A brighter copy on top, masked by a radial-gradient centered on the
 *    cursor (via CSS vars --mx/--my). The mask only reveals the bright copy in
 *    a circle around the pointer.
 *
 * mousemove writes the pointer position to a ref and schedules a single rAF to
 * apply it, so we never thrash layout on every event. Falls back to just the
 * faint base layer when the pointer leaves, on touch devices, and under
 * prefers-reduced-motion.
 */
export default function HeroDoodleGlow({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const glow = glowRef.current;
    if (!el || !glow) return;

    // Respect reduced-motion / no fine pointer: keep the faint base only.
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return;
    }

    const apply = () => {
      raf.current = null;
      glow.style.setProperty("--mx", `${pos.current.x}px`);
      glow.style.setProperty("--my", `${pos.current.y}px`);
    };

    // Track against the nearest positioned ancestor (the hero <section>) so the
    // glow follows the cursor across the whole hero — not just this layer, which
    // is pointer-events:none and would never receive the events itself.
    const tracked = (el.offsetParent as HTMLElement) ?? el;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      pos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setActive(true);
      if (raf.current === null) raf.current = requestAnimationFrame(apply);
    };
    const onLeave = () => setActive(false);

    tracked.addEventListener("mousemove", onMove);
    tracked.addEventListener("mouseleave", onLeave);
    return () => {
      tracked.removeEventListener("mousemove", onMove);
      tracked.removeEventListener("mouseleave", onLeave);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  // The reveal mask: a soft circle at (--mx,--my). When inactive the radius
  // collapses to 0 so the bright layer fades out (transition on opacity).
  const revealMask =
    "radial-gradient(circle 320px at var(--mx, 50%) var(--my, 40%), #000 0%, rgba(0,0,0,0.4) 55%, transparent 80%)";

  // Fade the doodle out toward the bottom (and just slightly at the top) so the
  // line-art dissolves into the section below instead of getting chopped by a
  // hard diagonal edge where the artwork ends.
  const fade =
    "linear-gradient(to bottom, transparent 0%, #000 8%, #000 55%, transparent 92%)";

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      {/* Base layer — always visible across the whole hero. */}
      <DoodleImg src={src} opacity={0.22} />
      {/* Bright layer — revealed only around the cursor. */}
      <div
        ref={glowRef}
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: active ? 1 : 0,
          maskImage: revealMask,
          WebkitMaskImage: revealMask,
        }}
      >
        <DoodleImg src={src} opacity={0.6} />
      </div>
    </div>
  );
}

// A doodle copy spanning the FULL hero (covering the left column too, so the
// left never reads as empty). cover + center keeps the line-art dense edge to
// edge; the glow lights up whatever is under the cursor.
function DoodleImg({ src, opacity }: { src: string; opacity: number }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        opacity,
        backgroundImage: `url(${src})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}
