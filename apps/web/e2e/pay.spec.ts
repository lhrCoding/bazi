/**
 * T48 前端支付流程 E2E。
 * 验收：三种 UA 显示正确的支付方式；mock 支付后自动到达报告页；/pay/done 的 URL 中无出生信息。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as {
  id: string;
  payload: string;
  hourKnown: boolean;
}[];
const withHour = cases.find((c) => c.hourKnown) ?? cases[0]!;
const noHour = cases.find((c) => !c.hourKnown)!;

const UA = {
  wechat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
};

async function openPay(page: Page, payload: string) {
  await page.goto(`/result#${payload}`);
  await page.getByTestId('pay-btn').click();
}

test.describe('微信内', () => {
  test.use({ userAgent: UA.wechat });
  test('确认面板：只有「微信支付 ¥9.9」', async ({ page }) => {
    await openPay(page, withHour.payload);
    const sheet = page.getByTestId('pay-sheet');
    await expect(sheet.getByTestId('pay-primary')).toHaveText('微信支付 ¥9.9');
    await expect(sheet.getByTestId('pay-secondary')).toHaveCount(0);
    await expect(sheet).toContainText('我们不保存出生信息');
    await sheet.getByRole('button', { name: '关闭' }).click();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe('其他手机浏览器', () => {
  test.use({ userAgent: UA.safari });
  test('支付宝 + 复制到微信；无时辰时内容清单换成缺失说明', async ({ page }) => {
    await openPay(page, withHour.payload);
    const sheet = page.getByTestId('pay-sheet');
    await expect(sheet.getByTestId('pay-primary')).toHaveText('支付宝支付 ¥9.9');
    await expect(sheet.getByTestId('pay-secondary')).toHaveText('复制链接，到微信中打开');
    await expect(sheet.getByTestId('sheet-nohour')).toHaveCount(0);
    await sheet.getByRole('button', { name: '关闭' }).click();
    await openPay(page, noHour.payload);
    await expect(page.getByTestId('sheet-nohour')).toContainText('未提供出生时辰');
  });

  test('mock 全流程：点「支付宝支付」即成功 → /pay/done（URL 无出生信息）→ 自动到报告页', async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await openPay(page, withHour.payload);
    await page.getByTestId('pay-primary').click();
    await page.waitForURL(/\/r\//);
    const u = new URL(page.url());
    const orderNo = u.pathname.split('/')[2] ?? '';
    expect(orderNo).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(u.hash.slice(1)).toBe(withHour.payload);
    await expect(page.getByTestId('legal-footer')).toBeVisible(); // T46：报告页也有免责声明
    expect(await page.evaluate((k) => localStorage.getItem(k), `pending:${orderNo}`)).toBeNull();
    const done = urls.filter((x) => x.includes('/pay/done'));
    expect(done.length).toBeGreaterThan(0);
    for (const x of urls) expect(x.split('#')[0]).not.toContain(withHour.payload);
    for (const x of done) {
      // 只带订单号（Next 预取会自动附加 _rsc 缓存参数）
      const sp = new URL(x).searchParams;
      sp.delete('_rsc');
      expect(sp.toString()).toBe(`o=${orderNo}`);
    }
  });

  test('返回页：本机没有载荷 → 提示回原浏览器；坏订单号 → 链接不完整', async ({
    page,
    request,
  }) => {
    const r = await request.post('/api/orders', {
      data: { payload: withHour.payload, channel: 'mock' },
    });
    const { orderNo } = (await r.json()) as { orderNo: string };
    await page.goto(`/pay/done?o=${orderNo}`);
    await expect(page.getByTestId('done-nopayload')).toBeVisible();
    await page.goto('/pay/done?o=bad');
    await expect(page.getByTestId('done-invalid')).toBeVisible();
  });
});

test.describe('电脑', () => {
  test.use({
    userAgent: UA.desktop,
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });
  test('居中面板：默认微信扫码，可切支付宝', async ({ page }) => {
    await openPay(page, withHour.payload);
    const panel = page.getByTestId('pay-desktop');
    await expect(panel.getByRole('button', { name: '微信扫码' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(panel.getByTestId('pay-primary')).toHaveText('生成微信支付二维码');
    await panel.getByRole('button', { name: '支付宝' }).click();
    await expect(panel.getByTestId('pay-primary')).toHaveText('前往支付宝付款 ¥9.9');
    await expect(page.getByTestId('pay-sheet')).toHaveCount(0);
  });
});
