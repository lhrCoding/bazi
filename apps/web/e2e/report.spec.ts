/**
 * T54 报告页框架 E2E。
 * 验收：关闭浏览器后用链接可重新打开；换浏览器可打开；无横向滚动；两条提示在首屏可见；页面内无追加付费按钮。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as {
  id: string;
  payload: string;
  hourKnown: boolean;
}[];

async function paidLink(request: APIRequestContext, payload: string): Promise<string> {
  const r = await request.post('/api/orders', { data: { payload, channel: 'mock' } });
  const { orderNo } = (await r.json()) as { orderNo: string };
  return `/r/${orderNo}#${payload}`;
}
const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('首次打开：保存提示大卡片与「勿公开分享」在首屏；9 章；无付费按钮；无横向滚动', async ({
  page,
  request,
}) => {
  const link = await paidLink(request, cases[0]!.payload);
  await page.goto(link);
  await expect(page.getByTestId('cover')).toBeVisible();
  const notice = page.getByTestId('save-notice');
  await expect(notice).toContainText('请先保存这份报告');
  await expect(notice).toContainText('链接丢失将无法找回');
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('share-warning')).toBeInViewport();
  for (let i = 0; i <= 8; i++) await expect(page.getByTestId(`chapter-${i}`)).toBeAttached();
  await expect(page.getByTestId('year-card')).toHaveCount(5);
  await expect(page.locator('button, a').filter({ hasText: /¥|付费|购买|解锁/ })).toHaveCount(0);
  await expect(page.getByTestId('legal-footer')).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
});

test('关闭后重新打开：同一浏览器显示常驻提示条（不可关闭）；内容逐字相同', async ({
  page,
  context,
  request,
}) => {
  const link = await paidLink(request, cases[1]!.payload);
  await page.goto(link);
  await expect(page.getByTestId('chapter-8')).toBeAttached();
  const text1 = await page.locator('.rp-wrap').innerText();
  await page.close();
  const p2 = await context.newPage();
  await p2.goto(link);
  const notice = p2.getByTestId('save-notice');
  await expect(notice).toContainText('链接丢失无法找回，请收藏本页或保存为长图');
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(p2.getByTestId('share-warning')).toBeInViewport();
  await expect(notice.getByRole('button', { name: /关闭|×/ })).toHaveCount(0);
  const text2 = await p2.locator('.rp-wrap').innerText();
  expect(text2.replace(/^[\s\S]*?命书/, '')).toBe(text1.replace(/^[\s\S]*?命书/, ''));
});

test('换浏览器（全新上下文，无 Cookie / localStorage）可打开', async ({ browser, request }) => {
  const link = await paidLink(request, cases[2]!.payload);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(link);
  await expect(p.getByTestId('chapter-0')).toBeAttached();
  await expect(p.getByTestId('save-notice')).toContainText('请先保存这份报告');
  await ctx.close();
});

test('无时辰报告：封面时柱「未知」并注明三柱', async ({ page, request }) => {
  const c = cases.find((x) => !x.hourKnown)!;
  await page.goto(await paidLink(request, c.payload));
  const cover = page.getByTestId('cover');
  await expect(cover).toContainText('未知');
  await expect(cover).toContainText('时辰未知，按三柱分析');
});

test('复制链接：复制完整 /r/订单号#载荷', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const link = await paidLink(request, cases[0]!.payload);
  await page.goto(link);
  await page.getByTestId('save-notice').getByRole('button', { name: /复制/ }).click();
  await expect(page.getByRole('status')).toContainText('已复制报告链接');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    new RegExp(`${link.replace(/[#/]/g, '\\$&')}$`),
  );
});

test('篡改载荷 / 缺载荷 → 链接无效提示，不显示报告', async ({ page, request }) => {
  const link = await paidLink(request, cases[0]!.payload);
  const [path] = link.split('#');
  await page.goto(`${path}#${cases[1]!.payload}`);
  await expect(page.getByTestId('report-error')).toContainText('链接无效或订单未支付');
  await page.goto(path!);
  await page.reload();
  await expect(page.getByTestId('report-error')).toContainText('链接不完整');
  await expect(page.getByTestId('cover')).toHaveCount(0);
});
