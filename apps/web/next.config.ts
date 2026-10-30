import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 部署用 Docker + standalone 产物（ARCHITECTURE 9.1）
  output: 'standalone',
  // core 以 TS 源码形式被引用，由 Next 编译
  transpilePackages: ['@zhiming/core'],
  poweredByHeader: false,
  reactStrictMode: true,
  // 不让 next dev 在仓库里自动生成 AGENTS.md
  agentRules: false,
};

export default nextConfig;
