import React from "react";

/**
 * The hackclub.com section wave: a single tight scalloped divider that the next
 * section's color rises into, so colored bands interlock instead of meeting on
 * a flat seam. (HC layers a thin stroke wave on top; that floated awkwardly over
 * our doodle band, so we use just the clean filled scallop.)
 *
 * `color` is the color the wave should be (i.e. the color of the band BELOW it,
 * which bleeds up). Absolutely positioned to sit flush at the bottom of its
 * nearest positioned ancestor — place it as the last child of the upper section.
 */
export default function WaveDivider({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1920 40"
      preserveAspectRatio="none"
      className="absolute left-0 right-0 bottom-[-1px] block w-full h-[36px] sm:h-[44px] z-20 pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill={color}
        d="M0,40 L0,27 C40,27 40,8 80,8 C120,8 120,27 160,27 C200,27 200,8 240,8 C280,8 280,27 320,27 C360,27 360,8 400,8 C440,8 440,27 480,27 C520,27 520,8 560,8 C600,8 600,27 640,27 C680,27 680,8 720,8 C760,8 760,27 800,27 C840,27 840,8 880,8 C920,8 920,27 960,27 C1000,27 1000,8 1040,8 C1080,8 1080,27 1120,27 C1160,27 1160,8 1200,8 C1240,8 1240,27 1280,27 C1320,27 1320,8 1360,8 C1400,8 1400,27 1440,27 C1480,27 1480,8 1520,8 C1560,8 1560,27 1600,27 C1640,27 1640,8 1680,8 C1720,8 1720,27 1760,27 C1800,27 1800,8 1840,8 C1880,8 1880,27 1920,27 L1920,40 Z"
      />
    </svg>
  );
}
