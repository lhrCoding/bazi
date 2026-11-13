/**
 * T65 运营统计：测试数据上统计正确；输出中无任何出生信息或指纹（也不含订单号）。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { birthInputToPayload, encodePayload } from '@zhiming/core/birth';
import { loadCases } from '../../../packages/core/test/helpers/cases';
import { handleChart } from '../server/chart-api';
import { createLogger } from '../server/log';
import { createOrder, markPaid, markRefunded, openOrdersDb } from '../server/orders';
import { createRateLimiter } from '../server/rate-limit';
import {
  aggregate,
  dayOf,
  dayRange,
  detectAnomalies,
  formatStats,
  pushAlert,
  readOrderTimes,
} from '../server/stats';

const FP = 'ab'.repeat(32);
const D1 = Date.parse('2026-11-12T10:00:00+08:00');
const D2 = Date.parse('2026-11-13T10:00:00+08:00');
const { cases } = loadCases();

function capture() {
  const lines: string[] = [];
  return {
    logger: createLogger(new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) })),
    text: () => lines.join(''),
  };
}

async function realChartLogs(n: number, now: number): Promise<string> {
  const { logger, text } = capture();
  for (let i = 0; i < n; i++) {
    const p = encodePayload(birthInputToPayload(cases[i % cases.length]!.input));
    await handleChart(
      new Request('http://x/api/chart', { method: 'POST', body: JSON.stringify({ payload: p }) }),
      { limiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }), logger, now: () => now },
    );
  }
  // pino 的 time 是写日志时刻：改写为测试日期
  return text().replace(/"time":\d+/g, `"time":${now}`);
}

describe('运营统计', () => {
  it('北京时间分日：23:59 与次日 00:00 分属两天', () => {
    expect(dayOf(Date.parse('2026-11-12T23:59:59+08:00'))).toBe('2026-11-12');
    expect(dayOf(Date.parse('2026-11-13T00:00:00+08:00'))).toBe('2026-11-13');
    expect(dayRange(D2, 3)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('订单（库）+ 排盘 / 报告事件（日志）按天统计正确；转化率；输出不含订单号、指纹、出生信息', async () => {
    const db = openOrdersDb(':memory:');
    const mk = (t: number) =>
      createOrder(db, { birthFp: FP, fpKeyId: 'k1', textsVersion: 0, now: t });
    const a = mk(D1);
    mk(D1);
    const b = mk(D2);
    markPaid(db, {
      orderNo: a.orderNo,
      amountFen: 990,
      channel: 'mock',
      channelTxnId: 'T1',
      now: D1,
    });
    markPaid(db, {
      orderNo: b.orderNo,
      amountFen: 990,
      channel: 'mock',
      channelTxnId: 'T2',
      now: D2,
    });
    markRefunded(db, a.orderNo, '用户申请', D2);
    const logs =
      (await realChartLogs(4, D1)) +
      (await realChartLogs(2, D2)) +
      [
        { level: 'info', time: D2, evt: 'report', orderNo: b.orderNo, fallback: 3, slotEmpty: 1 },
        { level: 'warn', time: D2, evt: 'rcheck_failed', orderNo: b.orderNo },
        { level: 'error', time: D2, msg: 'boom' },
        { level: 'info', time: D2 - 3 * 86_400_000, evt: 'chart' }, // 范围外
      ]
        .map((x) => JSON.stringify(x))
        .join('\n');
    const days = dayRange(D2, 2);
    const stats = aggregate(
      days,
      readOrderTimes(db, Date.parse(`${days[0]}T00:00:00+08:00`)),
      logs,
    );
    expect(stats).toEqual([
      {
        day: '2026-11-12',
        created: 2,
        paid: 1,
        refunded: 0,
        charts: 4,
        reports: 0,
        fallback: 0,
        slotEmpty: 0,
        rcheckFailed: 0,
        errors: 0,
      },
      {
        day: '2026-11-13',
        created: 1,
        paid: 1,
        refunded: 1,
        charts: 2,
        reports: 1,
        fallback: 3,
        slotEmpty: 1,
        rcheckFailed: 1,
        errors: 1,
      },
    ]);
    const out = formatStats(stats) + detectAnomalies(stats).join('\n');
    expect(out).toContain('25.0%'); // 11-12：1 / 4
    expect(out).toContain('50.0%'); // 11-13：1 / 2
    for (const bad of [a.orderNo, b.orderNo, FP, ...cases.slice(0, 4).map((c) => c.input.date)])
      expect(out).not.toContain(bad);
  });

  it('异常：下单多但零支付、错误日志、R-CHECK、空槽位；正常日无告警', () => {
    const base = {
      day: '2026-11-13',
      created: 0,
      paid: 0,
      refunded: 0,
      charts: 0,
      reports: 0,
      fallback: 0,
      slotEmpty: 0,
      rcheckFailed: 0,
      errors: 0,
    };
    expect(detectAnomalies([{ ...base, created: 3, paid: 1, charts: 10 }])).toEqual([]);
    const a = detectAnomalies([{ ...base, created: 6, errors: 2, rcheckFailed: 1, slotEmpty: 2 }]);
    expect(a).toHaveLength(4);
    expect(a[0]).toContain('支付 0 笔');
  });

  it('推送企业微信：文本消息格式；无告警不推送（mock webhook）', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{"errcode":0}');
    }) as unknown as typeof fetch;
    expect(await pushAlert('https://hook.example/x', [], fake)).toBe(false);
    expect(await pushAlert('https://hook.example/x', ['A', 'B'], fake)).toBe(true);
    expect(calls).toEqual([
      {
        url: 'https://hook.example/x',
        body: { msgtype: 'text', text: { content: '【知命 运营告警】\nA\nB' } },
      },
    ]);
  });
});
