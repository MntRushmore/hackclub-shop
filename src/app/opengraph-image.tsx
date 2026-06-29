import { ImageResponse } from "next/og";

/**
 * The social share card (1200×630) parents see when they text or post the shop
 * link. Rendered at build time by Next's OG image route using Satori, so it's a
 * real branded card instead of a bare URL. Kept to Satori's flexbox subset and
 * a system font stack (Phantom Sans isn't loaded here); the brand reads through
 * the red wordmark, the headline, and the orange→red gradient bar.
 */

export const runtime = "edge";
export const alt =
  "Hack Club Shop. You raised a Hack Clubber. Every purchase supports teenagers at Hack Club.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const RED = "#ec3750";
  const ORANGE = "#ff8c37";
  const DARK = "#17171d";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* eyebrow wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 6,
            color: RED,
          }}
        >
          HACK CLUB SHOP
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 104,
              fontWeight: 900,
              lineHeight: 1.0,
              letterSpacing: -2,
              color: DARK,
            }}
          >
            You raised a
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 104,
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: RED,
            }}
          >
            Hack Clubber.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 36,
              fontWeight: 600,
              color: "#3c4858",
              maxWidth: 900,
            }}
          >
            Every purchase supports the teenagers who build, ship, and dream at
            Hack Club.
          </div>
        </div>

        {/* gradient base bar */}
        <div
          style={{
            display: "flex",
            height: 16,
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${ORANGE}, ${RED})`,
          }}
        />
      </div>
    ),
    size
  );
}
