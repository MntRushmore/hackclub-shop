// Defense-in-depth response headers applied to every route. Kept conservative
// (no restrictive Content-Security-Policy) so as not to break Next's inline
// runtime; these address clickjacking, MIME-sniffing, TLS downgrade, and
// referrer/permissions leakage.
const securityHeaders = [
  // Force HTTPS for 2 years incl. subdomains (shop.hackclub.com is HTTPS-only).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Block MIME-sniffing of served assets.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking protection — the shop is never meant to be framed.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  // Don't leak full URLs (which can carry ids) to third-party origins.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Drop access to powerful APIs the shop doesn't use.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['files.cdn.printful.com', 'hackclub.com', 'assets.hackclub.com', 'avatars.slack-edge.com', 'cdn.isitzoe.dev' ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    // Keep @vercel/blob (and its undici dependency) as a runtime require instead
    // of bundling it through webpack, which fails on Next 13.4's loader.
    serverComponentsExternalPackages: ['@vercel/blob'],
  },
};


export default nextConfig;
