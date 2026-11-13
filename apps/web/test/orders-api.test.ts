/**
 * T47 支付抽象 + mock 渠道 + 订单 API。
 * 验收：mock 全流程走通；重复回调只处理一次；下单请求发给渠道的参数里搜不到出生信息（测试断言）。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { birthInputToPayload, canonicalJson, encodePayload } from '@zhiming/core/birth';
import { loadCases } from '../../../packages/core/test/helpers/cases';
import { birthFp, type FpKey } from '../server/birth-fp';
import { createLogger } from '../server/log';
import {
  handleCreateOrder,
  handleNotify,
  handleOrderStatus,
  QUERY_AFTER_MS,
  type OrdersDeps,
} from '../server/orders-api';
import { getOrder, openOrdersDb } from '../server/orders';
import { createMockProvider } from '../server/payment/mock';
import { createRateLimiter } from '../server/rate-limit';

const T0 = Date.parse('2026-11-13T10:00:00+08:00');
const KEY: FpKey = { key: Buffer.alloc(32, 7), keyId: 'k1' };
const { cases } = loadCases();
const c16 = cases.find((c) => c.id === 'C16');
if (!c16) throw new Error('C16');
const P = birthInputToPayload(c16.input);
const PAYLOAD = encodePayload(P);

function setup() {
  const lines: string[] = [];
  const logger = createLogger(
    new Writable({ write: (ch, _e, cb) => (lines.push(String(ch)), cb()) }),
  );
  let now = T0;
  const mock = createMockProvider({ siteUrl: 'http://localhost' });
  const deps: OrdersDeps = {
    db: openOrdersDb(':memory:'),
    fpKey: KEY,
    textsVersion: () => 3,
    providers: { mock },
    limiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    logger,
    now: () => now,
    siteUrl: 'http://localhost',
    lastQuery: new Map(),
  };
  return { deps, mock, logs: () => lines.join(''), tick: (ms: number) => (now += ms) };
}
const post = (body: unknown) =>
  new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const status = async (deps: OrdersDeps, no: string) =>
  (
    (await (await handleOrderStatus(no, new Request('http://localhost/x'), deps)).json()) as {
      status: string;
    }
  ).status;

async function create(deps: OrdersDeps) {
  const res = await handleCreateOrder(post({ payload: PAYLOAD, channel: 'mock' }), deps);
  expect(res.status).toBe(201);
  return (await res.json()) as { orderNo: string; pay: { kind: string; url: string } };
}

describe('mock 全流程', () => {
  it('建单 → 模拟支付页 → 回调 → paid；订单字段正确', async () => {
    const { deps, mock, logs } = setup();
    const { orderNo, pay } = await create(deps);
    expect(pay).toEqual({ kind: 'redirect', url: `/pay/done?o=${orderNo}` });
    expect(getOrder(deps.db, orderNo)).toMatchObject({
      status: 'created',
      amountFen: 990,
      textsVersion: 3,
      fpKeyId: 'k1',
      channel: 'mock',
      birthFp: birthFp(canonicalJson(P), KEY),
      createdAt: T0,
    });
    expect(await status(deps, orderNo)).toBe('created');
    const r = mock.pay(orderNo);
    expect(r).not.toBeNull();
    const ack = await handleNotify('mock', r!.notify, deps);
    expect(ack.status).toBe(200);
    expect(await status(deps, orderNo)).toBe('paid');
    expect(getOrder(deps.db, orderNo)?.channelTxnId).toBe(r!.paid.channelTxnId);
    expect(logs()).not.toContain(PAYLOAD);
    expect(logs()).not.toContain(P.d);
  });

  it('重复回调只处理一次', async () => {
    const { deps, mock, logs } = setup();
    const { orderNo } = await create(deps);
    for (let i = 0; i < 3; i++) {
      const r = mock.pay(orderNo);
      expect((await handleNotify('mock', r!.notify, deps)).status).toBe(200);
    }
    expect(logs().match(/order paid/g)).toHaveLength(1);
    expect(getOrder(deps.db, orderNo)?.status).toBe('paid');
  });

  it('伪造回调（签名不对 / 另一个进程的密钥）被拒，订单不变', async () => {
    const { deps } = setup();
    const { orderNo } = await create(deps);
    const other = createMockProvider({ siteUrl: 'http://localhost' });
    await other.createPayment({
      orderNo,
      amountFen: 990,
      description: '八字命盘报告',
      notifyUrl: '/api/pay/notify/mock',
      returnUrl: '/',
      clientIp: '1.1.1.1',
      openid: null,
    });
    const forged = other.pay(orderNo);
    expect((await handleNotify('mock', forged!.notify, deps)).status).toBe(400);
    expect((await handleNotify('wechat_jsapi', post('{}'), deps)).status).toBe(404);
    expect(getOrder(deps.db, orderNo)?.status).toBe('created');
  });

  it('回调丢失：10 秒前不查单，10 秒后查单兜底置 paid；查单有频率限制', async () => {
    const { deps, mock, tick } = setup();
    const { orderNo } = await create(deps);
    mock.pay(orderNo); // 不投递回调
    let queries = 0;
    const q = mock.queryOrder.bind(mock);
    mock.queryOrder = async (no) => (queries++, q(no));
    tick(QUERY_AFTER_MS - 1);
    expect(await status(deps, orderNo)).toBe('created');
    expect(queries).toBe(0);
    tick(1);
    expect(await status(deps, orderNo)).toBe('paid');
    expect(queries).toBe(1);
  });

  it('未付款时查单 5 秒内最多一次', async () => {
    const { deps, mock, tick } = setup();
    const { orderNo } = await create(deps);
    let queries = 0;
    mock.queryOrder = async () => (queries++, null);
    tick(QUERY_AFTER_MS);
    for (let i = 0; i < 4; i++) await status(deps, orderNo);
    expect(queries).toBe(1);
    tick(5_000);
    await status(deps, orderNo);
    expect(queries).toBe(2);
  });
});

describe('mock 自动支付（用户 2026-11-13：点支付即成功）', () => {
  it('下单即按回调流程置 paid，只记一次', async () => {
    const { deps, logs } = setup();
    deps.providers.mock = createMockProvider({ siteUrl: 'http://localhost', autoPay: true });
    const { orderNo, pay } = await create(deps);
    expect(pay.url).toBe(`/pay/done?o=${orderNo}`);
    expect(getOrder(deps.db, orderNo)).toMatchObject({ status: 'paid', channel: 'mock' });
    expect(logs().match(/order paid/g)).toHaveLength(1);
  });
});

describe('发给渠道的参数不含出生信息', () => {
  it('20 个案例：CreatePaymentInput 里搜不到日期、时间、载荷、规范串、指纹', async () => {
    const { deps, mock } = setup();
    for (const c of cases) {
      const p = birthInputToPayload(c.input);
      const enc = encodePayload(p);
      const res = await handleCreateOrder(post({ payload: enc, channel: 'mock' }), deps);
      expect(res.status, c.id).toBe(201);
      const sent = JSON.stringify(mock.lastCreate);
      const [y, m, d] = p.d.split('-');
      for (const needle of [
        enc,
        canonicalJson(p),
        birthFp(canonicalJson(p), KEY),
        p.d,
        `${y}${m}${d}`,
      ]) {
        expect(sent, c.id).not.toContain(needle);
      }
      if (p.t) expect(sent, c.id).not.toContain(p.t);
      if (p.p) expect(sent, c.id).not.toContain(p.p);
      expect(Object.keys(mock.lastCreate ?? {}).sort()).toEqual([
        'amountFen',
        'clientIp',
        'description',
        'notifyUrl',
        'openid',
        'orderNo',
        'returnUrl',
      ]);
      expect(mock.lastCreate?.returnUrl).toMatch(/\/pay\/done\?o=[0-9A-Za-z]{22}$/);
    }
  });
});

describe('下单错误', () => {
  const bad: [string, unknown, number, string][] = [
    ['坏载荷', { payload: '!!!', channel: 'mock' }, 400, 'E_PAYLOAD_ENCODING'],
    ['未启用渠道', { payload: PAYLOAD, channel: 'wechat_jsapi' }, 400, 'E_CHANNEL_UNAVAILABLE'],
    ['未知渠道', { payload: PAYLOAD, channel: 'paypal' }, 400, 'E_INVALID_INPUT'],
    ['多余字段', { payload: PAYLOAD, channel: 'mock', date: '1993-01-01' }, 400, 'E_INVALID_INPUT'],
    ['非 JSON', 'x', 400, 'E_BAD_REQUEST'],
  ];
  for (const [name, body, code, err] of bad) {
    it(`${name} → ${code} ${err}，不建单`, async () => {
      const { deps } = setup();
      const res = await handleCreateOrder(post(body), deps);
      expect(res.status).toBe(code);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(err);
      expect(deps.db.$client.prepare('SELECT count(*) AS n FROM orders').get()).toEqual({ n: 0 });
    });
  }
  it('不存在的订单号 → 404', async () => {
    const { deps } = setup();
    const r = await handleOrderStatus('A'.repeat(22), new Request('http://localhost/x'), deps);
    expect(r.status).toBe(404);
  });
});
