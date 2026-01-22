/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['files.cdn.printful.com', 'hackclub.com', 'assets.hackclub.com', 'avatars.slack-edge.com', 'cdn.isitzoe.dev' ],
  },
};


export default nextConfig;
