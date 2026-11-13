/**
 * 每次请求生成 CSP nonce（TASKS T59）。Next 读取请求头里的 CSP 自动给内联脚本加 nonce，因此页面须动态渲染（根布局已设）。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from './server/security-headers';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === 'development',
    https: (process.env.SITE_URL ?? '').startsWith('https://'),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    // 页面请求；跳过静态资源、图片、API（API 只返回 JSON）与 next/link 预取
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|fonts/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
