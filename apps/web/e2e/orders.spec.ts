/**
 * T47 E2E（API 级）：在 next start 生产构建里走通「建单 → mock 自动支付 → paid」，并确认 better-sqlite3 在 Next 运行时可用。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as {
  payload: string;
}[];

test('mock 自动支付：建单即 paid（用户 2026-11-13：真实支付留白）', async ({ request }) => {
  const res = await request.post('/api/orders', {
    data: { payload: cases[0]?.payload, channel: 'mock' },
  });
  expect(res.status()).toBe(201);
  const { orderNo, pay } = (await res.json()) as { orderNo: string; pay: { url: string } };
  expect(orderNo).toMatch(/^[0-9A-Za-z]{22}$/);
  expect(pay.url).toBe(`/pay/done?o=${orderNo}`);
  expect(await (await request.get(`/api/orders/${orderNo}/status`)).json()).toEqual({
    status: 'paid',
  });
});

test('不支持的渠道 → E_CHANNEL_UNAVAILABLE；未知订单 → 404', async ({ request }) => {
  const r = await request.post('/api/orders', {
    data: { payload: cases[0]?.payload, channel: 'wechat_jsapi' },
  });
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
    'E_CHANNEL_UNAVAILABLE',
  );
  expect((await request.get(`/api/orders/${'A'.repeat(22)}/status`)).status()).toBe(404);
});
