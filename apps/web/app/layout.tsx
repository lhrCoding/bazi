import type { Metadata, Viewport } from 'next';
import './globals.css';

// CSP nonce 每次请求不同（proxy.ts），所有页面须动态渲染（T59）
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '一元知命',
  description: '八字命盘参考（传统文化参考，仅供娱乐）',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
