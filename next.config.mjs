/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['files.cdn.printful.com', 'hackclub.com', 'assets.hackclub.com', 'avatars.slack-edge.com', 'cdn.isitzoe.dev' ],
  },
  experimental: {
    // Keep @vercel/blob (and its undici dependency) as a runtime require instead
    // of bundling it through webpack, which fails on Next 13.4's loader.
    serverComponentsExternalPackages: ['@vercel/blob'],
  },
};


export default nextConfig;
