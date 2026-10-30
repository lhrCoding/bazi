import type { Metadata, Viewport } from 'next';
import './globals.css';

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
