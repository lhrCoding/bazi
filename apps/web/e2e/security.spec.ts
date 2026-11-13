/**
 * T59 安全响应头与 CSP。
 * 验收：E2E 断言响应头；全站无第三方脚本（脚本全部同源、全流程无外站请求、无 CSP 违规）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as {
  payload: string;
}[];

test('响应头：CSP（nonce、frame-ancestors none）、no-referrer、noindex', async ({ request }) => {
  const nonces = new Set<string>();
  for (const path of ['/', '/result', '/privacy', '/disclaimer', '/pay/done?o=x', '/r/abc']) {
    const r = await request.get(path);
    const h = r.headers();
    const csp = h['content-security-policy'] ?? '';
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).toContain("object-src 'none'");
    expect(csp, path).not.toContain('unsafe-eval');
    nonces.add(/nonce-([^']+)/.exec(csp)?.[1] ?? '');
    expect(h['referrer-policy'], path).toBe('no-referrer');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    const noindex = /^\/(r|result|pay)\b/.test(path);
    expect(h['x-robots-tag'] ?? '', path).toBe(noindex ? 'noindex, nofollow' : '');
    // 页面里每个 <script> 要么同源 src，要么带本次 nonce
    const html = await r.text();
    const nonce = /nonce-([^']+)/.exec(csp)?.[1] ?? '';
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      const src = /\ssrc="([^"]+)"/.exec(tag)?.[1];
      if (src) expect(src.startsWith('/'), `${path} ${src}`).toBe(true);
      else expect(tag, path).toContain(`nonce="${nonce}"`);
    }
  }
  expect(nonces.size).toBe(6); // 每次请求 nonce 都不同
});

test('全流程（首页 → 结果 → 付款 → 报告）：无 CSP 违规、无任何外站请求', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && u.origin !== origin) foreign.push(r.url());
  });
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Refused to load (CSP) ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.goto('/');
  await page.getByLabel('年', { exact: true }).selectOption('1990');
  await page.getByLabel('月', { exact: true }).selectOption('3');
  await page.getByLabel('日', { exact: true }).selectOption('20');
  await page.getByLabel('不知道').check();
  await page.getByRole('group', { name: '性别' }).getByRole('button', { name: '女' }).click();
  await page.getByRole('button', { name: '免费排盘' }).click();
  await page.waitForURL(/\/result#/);
  await expect(page.getByTestId('mod-yongshen')).toBeVisible();
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('pay-primary').click();
  await page.waitForURL(/\/r\//);
  await expect(page.getByTestId('chapter-8')).toBeAttached();
  await page.goto('/privacy');
  await page.goto(`/result#${cases[0]?.payload ?? ''}`);
  await expect(page.getByTestId('mod-power')).toBeVisible();
  expect(violations).toEqual([]);
  expect(foreign).toEqual([]);
});
