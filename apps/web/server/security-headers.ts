/**
 * 安全响应头与 CSP（TASKS T59；ARCHITECTURE §6.4，UI.md §2.2 / §2.5）。纯函数，proxy.ts 与测试共用。
 *
 * - script-src：'self' + 每次请求的 nonce + 'strict-dynamic'（Next 的内联 RSC 脚本带 nonce）；开发模式另需 'unsafe-eval'。
 * - style-src：'self' 'unsafe-inline'——页面用 style 属性画条形宽度与档位色块，style 属性不能带 nonce；样式注入风险远低于脚本。
 * - img-src 'self' data:（纸纹是内联 data URI SVG）；font-src 'self'（不加载第三方字体）。
 * - connect-src / form-action：'self' + 支付渠道所需域名（真实支付接入时在 PAYMENT_ORIGINS 里加，现为空）。
 * - frame-ancestors 'none'；只有站点为 https 时才加 upgrade-insecure-requests（本地 http 测试不受影响）。
 */

/** 真实支付接入（T49–T51）时需要放行的域名，如支付宝收银台表单提交地址 */
export const PAYMENT_ORIGINS: { connect: readonly string[]; form: readonly string[] } = {
  connect: [],
  form: [],
};

export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const d = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ["connect-src 'self'", ...PAYMENT_ORIGINS.connect].join(' '),
    ["form-action 'self'", ...PAYMENT_ORIGINS.form].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ];
  if (opts.https) d.push('upgrade-insecure-requests');
  return d.join('; ');
}

/** 全站静态安全头（next.config.ts headers()） */
export const STATIC_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** 含出生信息或因人而异的页面：不让搜索引擎收录 */
export const NOINDEX_PATHS: readonly string[] = ['/r/:path*', '/result', '/pay/:path*'];
