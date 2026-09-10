import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['bullmq', 'ioredis', 'sharp', 'bcryptjs'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
