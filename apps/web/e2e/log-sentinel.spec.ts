/**
 * T60 日志不含出生信息的哨兵测试（PRD P0-10）。
 * 用特征出生信息跑：免费排盘、各类非法输入、下单、mock 支付、支付返回页、打开报告、篡改链接、错误订单号，
 * 然后在服务进程的 stdout / stderr（.e2e-logs/server.log）里搜日期多种写法、时间、载荷全串及任意 16 字符子串、规范串。
 * 验收：零命中。检测器本身的有效性（故意 log(payload) 时一定命中）见 test/log-sentinel.test.ts。
 * Docker 环境下的 Caddy 日志在 T61 后补充。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { findLeaks, SENTINEL, sentinelPayload } from './sentinel';

const LOG = join(__dirname, '..', '.e2e-logs', 'server.log');
const P = sentinelPayload();
const variant = (patch: Record<string, unknown>) =>
  sentinelPayload(JSON.stringify({ ...JSON.parse(SENTINEL.canonical), ...patch }));

test('全流程后服务日志零命中', async ({ page, request }) => {
  test.skip(!existsSync(LOG), '复用了已有服务（无日志文件），在 CI / 全新启动时运行');
  const before = readFileSync(LOG, 'utf8').length;

  // 免费排盘：正常 + 各类非法输入（含把出生信息直接放进请求体）
  expect((await request.post('/api/chart', { data: { payload: P } })).status()).toBe(200);
  const badCharts = [
    `${SENTINEL.date} ${SENTINEL.time}`,
    JSON.stringify({ payload: P, date: SENTINEL.date, time: SENTINEL.time }),
    JSON.stringify({ payload: variant({ c: 'l', lp: 1 }) }), // 1977 无闰月
    JSON.stringify({ payload: variant({ t: '25:61' }) }),
    JSON.stringify({ payload: variant({ p: '999999' }) }),
    JSON.stringify({ payload: `${P}!!` }),
    JSON.stringify({ payload: P.repeat(20) }),
  ];
  for (const body of badCharts) {
    const r = await request.post('/api/chart', {
      data: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status(), body.slice(0, 40)).toBeGreaterThanOrEqual(400);
  }

  // 下单（含非法）、状态、支付返回页
  const bad = await request.post('/api/orders', {
    data: { payload: P, channel: 'mock', d: SENTINEL.date },
  });
  expect(bad.status()).toBe(400);
  const o = await request.post('/api/orders', { data: { payload: P, channel: 'mock' } });
  expect(o.status()).toBe(201);
  const { orderNo } = (await o.json()) as { orderNo: string };
  expect((await request.get(`/api/orders/${orderNo}/status`)).status()).toBe(200);

  // 报告：正常、篡改、错误订单号、非法体
  expect((await request.post('/api/report', { data: { orderNo, payload: P } })).status()).toBe(200);
  expect(
    (
      await request.post('/api/report', { data: { orderNo, payload: variant({ t: '13:58' }) } })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post('/api/report', { data: { orderNo: 'X'.repeat(22), payload: P } })).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/report', { data: { orderNo, payload: P, birth: SENTINEL.date } })
    ).status(),
  ).toBe(403);
  await request.get(`/api/places?q=${encodeURIComponent(SENTINEL.date)}`);

  // 浏览器全流程：结果页 → 付款 → 返回页 → 报告页；再打开篡改链接
  await page.goto(`/result#${P}`);
  await expect(page.getByTestId('mod-yongshen')).toBeVisible();
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('pay-primary').click();
  await page.waitForURL(/\/r\//);
  await expect(page.getByTestId('chapter-8')).toBeAttached();
  await page.goto(`/r/${orderNo}#${variant({ g: 'm' })}`);
  await expect(page.getByTestId('report-error')).toBeVisible();

  await page.waitForTimeout(500); // 等日志落盘
  const log = readFileSync(LOG, 'utf8').slice(before);
  expect(log.length).toBeGreaterThan(0); // 确实收集到了本轮日志（非法请求会写 warn）
  expect(findLeaks(log)).toEqual([]);
});
