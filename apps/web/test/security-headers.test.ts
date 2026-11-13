/** T59 CSP 生成：开发模式才有 unsafe-eval；https 站点才升级不安全请求；不放行任何第三方脚本来源。 */
import { expect, it } from 'vitest';
import { buildCsp, PAYMENT_ORIGINS } from '../server/security-headers';

it('生产 http / https / 开发', () => {
  const prod = buildCsp('abc', { dev: false, https: false });
  expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
  expect(prod).not.toContain('unsafe-eval');
  expect(prod).not.toContain('upgrade-insecure-requests');
  expect(buildCsp('abc', { dev: false, https: true })).toContain('upgrade-insecure-requests');
  expect(buildCsp('abc', { dev: true, https: false })).toContain("'unsafe-eval'");
});

it('script-src 只有本站与 nonce；支付域名清单目前为空', () => {
  const script = /script-src ([^;]+)/.exec(buildCsp('n', { dev: false, https: true }))?.[1] ?? '';
  expect(script.split(' ')).toEqual(["'self'", "'nonce-n'", "'strict-dynamic'"]);
  expect(PAYMENT_ORIGINS.connect).toEqual([]);
  expect(PAYMENT_ORIGINS.form).toEqual([]);
});
