import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.KLINE_RUNTIME === 'node' ? 'standalone' : undefined,
};

export default nextConfig;
