/**
 * T53 报告 API POST /api/report。
 * 验收：篡改载荷 → 拒绝；未付款 → 拒绝；同一订单不同时间请求返回逐字相同的报告；服务端 p95 < 400 ms。
 */
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { birthInputToPayload, canonicalJson, encodePayload } from '@zhiming/core/birth';
import { loadCases } from '../../../packages/core/test/helpers/cases';
import { textsKeyOf } from '../server/app-context';
import { birthFp, type FpKey } from '../server/birth-fp';
import { createLogger } from '../server/log';
import { createOrder, markPaid, markRefunded, openOrdersDb } from '../server/orders';
import { createRateLimiter } from '../server/rate-limit';
import {
  FAIL_LIMIT,
  handleReport,
  type ReportDeps,
  type ReportResponse,
} from '../server/report-api';
import { loadReportResources, type ReportResources } from '../server/report-resources';
import { loadWorkspace, type TextsStore } from '../server/texts-store';

const RULES = fileURLToPath(new URL('../../../rules', import.meta.url));
const KEY: FpKey = { key: Buffer.alloc(32, 9), keyId: 'k1' };
const T0 = Date.parse('2026-11-13T10:00:00+08:00');
const { cases } = loadCases();
const payloadOf = (id: string) => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return birthInputToPayload(c.input);
};

let texts: TextsStore;
let resources: ReportResources;
beforeAll(() => {
  texts = loadWorkspace(join(RULES, 'texts'), ['draft', 'reviewed', 'approved']);
  resources = loadReportResources(RULES);
});

function setup() {
  const lines: string[] = [];
  let now = T0 + 60_000;
  const deps: ReportDeps = {
    db: openOrdersDb(':memory:'),
    fpKey: KEY,
    texts,
    textsKeyOf,
    resources,
    limiter: createRateLimiter({ limit: 10_000, windowMs: 60_000 }),
    failures: new Map(),
    logger: createLogger(new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) })),
    now: () => now,
  };
  const order = (id: string, paid = true) => {
    const p = payloadOf(id);
    const o = createOrder(deps.db, {
      birthFp: birthFp(canonicalJson(p), KEY),
      fpKeyId: 'k1',
      textsVersion: 0,
      now: T0,
      channel: 'mock',
    });
    if (paid)
      markPaid(deps.db, {
        orderNo: o.orderNo,
        amountFen: 990,
        channel: 'mock',
        channelTxnId: 'T1',
        now: T0,
      });
    return { orderNo: o.orderNo, payload: encodePayload(p) };
  };
  return { deps, order, logs: () => lines.join(''), tick: (ms: number) => (now += ms) };
}

const call = async (deps: ReportDeps, body: unknown) => {
  const res = await handleReport(
    new Request('http://localhost/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7' },
      body: JSON.stringify(body),
    }),
    deps,
  );
  return { status: res.status, text: await res.text(), headers: res.headers };
};
const code = (t: string) => (JSON.parse(t) as { error: { code: string } }).error.code;

describe('正常返回', () => {
  it('9 章；meta 版本与参考日期 = 订单创建时间；no-store；不记载荷', async () => {
    const { deps, order, logs } = setup();
    const o = order('C16');
    const r = await call(deps, o);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const rep = JSON.parse(r.text) as ReportResponse;
    expect(rep.chapters.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rep.meta).toMatchObject({ textsVersion: 'dev', refDate: T0 });
    expect(Object.keys(rep).sort()).toEqual(['chapters', 'meta']);
    expect(logs()).not.toContain(o.payload);
  });

  it('同一订单不同时间请求：逐字相同', async () => {
    const { deps, order, tick } = setup();
    const o = order('C11');
    const a = await call(deps, o);
    tick(400 * 24 * 3600 * 1000); // 一年多以后再打开
    const b = await call(deps, o);
    expect(b.status).toBe(200);
    expect(b.text).toBe(a.text);
  });
});

describe('拒绝：统一「链接无效或订单未支付」', () => {
  it('篡改载荷 / 换成别人的载荷 / 未付款 / 已退款 / 不存在 / 订单号格式错', async () => {
    const { deps, order } = setup();
    const o = order('C16');
    const other = encodePayload(payloadOf('C11'));
    const tampered = encodePayload({
      ...payloadOf('C16'),
      g: payloadOf('C16').g === 'm' ? 'f' : 'm',
    });
    const unpaid = order('C08', false);
    const refunded = order('C01');
    markRefunded(deps.db, refunded.orderNo, '用户申请退款', T0 + 1000);
    const bad: unknown[] = [
      { ...o, payload: tampered },
      { ...o, payload: other },
      { ...o, payload: '!!!' },
      unpaid,
      refunded,
      { orderNo: 'A'.repeat(22), payload: o.payload },
      { orderNo: 'short', payload: o.payload },
      { ...o, extra: 1 },
    ];
    for (const b of bad) {
      const r = await call(deps, b);
      expect(r.status, JSON.stringify(b)).toBe(403);
      expect(code(r.text)).toBe('E_REPORT_LINK_INVALID');
      expect(r.text).not.toContain('1987');
    }
  });

  it(`同一订单号失败 ≥ ${FAIL_LIMIT} 次锁定 1 小时（正确链接也暂时打不开），过期解锁`, async () => {
    const { deps, order, tick } = setup();
    const o = order('C16');
    const wrong = encodePayload(payloadOf('C11'));
    for (let i = 0; i < FAIL_LIMIT; i++)
      expect((await call(deps, { ...o, payload: wrong })).status).toBe(403);
    expect((await call(deps, o)).status).toBe(429);
    tick(60 * 60 * 1000);
    expect((await call(deps, o)).status).toBe(200);
  });

  it('密钥编号不一致：拒绝并告警', async () => {
    const { deps, order, logs } = setup();
    const o = order('C16');
    deps.fpKey = { key: KEY.key, keyId: 'k2' };
    expect((await call(deps, o)).status).toBe(403);
    expect(logs()).toContain('fp key id mismatch');
  });

  it('订单的素材版本不存在：500 并告警', async () => {
    const { deps, order, logs } = setup();
    const o = order('C16');
    deps.textsKeyOf = () => '999';
    expect((await call(deps, o)).status).toBe(500);
    expect(logs()).toContain('texts version missing');
  });
});

describe('性能', () => {
  it('服务端 p95 < 400 ms（20 个案例各 2 次）', async () => {
    const { deps, order } = setup();
    const orders = cases.map((c) => order(c.id));
    const ms: number[] = [];
    for (let i = 0; i < 2; i++)
      for (const o of orders) {
        const t = performance.now();
        const r = await call(deps, o);
        ms.push(performance.now() - t);
        expect(r.status).toBe(200);
      }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(ms.length * 0.95) - 1] ?? Infinity;
    expect(p95).toBeLessThan(400);
  });
});
