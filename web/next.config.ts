import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Dev and production builds must not share a build directory.
   *
   * `next dev` rewrites .next for development, which deletes the BUILD_ID and
   * the hashed static chunks a running `next start` is serving — the server
   * then answers 400 for every stylesheet and script, or refuses to boot at
   * all. An editor that launches `npm run dev` in the background makes this
   * happen at random. Separate directories let both run at once.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['bullmq', 'ioredis', 'sharp', 'bcryptjs'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
