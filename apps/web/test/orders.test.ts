/**
 * T42 SQLite + Drizzle 订单表与状态机。
 * 验收：合法 / 非法迁移全覆盖；重复置 paid 只生效一次；金额不符拒绝；订单号熵测试；列名集合与白名单完全相等。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AMOUNT_FEN,
  canTransition,
  createOrder,
  generateOrderNo,
  getOrder,
  markClosed,
  markPaid,
  markRefunded,
  openOrdersDb,
  ORDER_COLUMNS,
  ORDER_NO_RE,
  ORDER_STATUSES,
  OrderError,
  orders,
  runMigrations,
  TRANSITIONS,
  type OrdersDb,
  type OrderStatus,
} from '../server/orders';

const FP = 'a'.repeat(64);
const T0 = Date.parse('2026-11-13T10:00:00+08:00');
const newDb = (): OrdersDb => openOrdersDb(':memory:');
const order = (db: OrdersDb) =>
  createOrder(db, { birthFp: FP, fpKeyId: 'k1', textsVersion: 1, now: T0 });
const paid = (orderNo: string, over: Partial<Parameters<typeof markPaid>[1]> = {}) => ({
  orderNo,
  amountFen: AMOUNT_FEN,
  channel: 'mock' as const,
  channelTxnId: 'TXN-1',
  now: T0 + 60_000,
  ...over,
});
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof OrderError ? e.code : String(e);
  }
  return undefined;
};

describe('列名白名单（ARCHITECTURE §5.1 表结构评审）', () => {
  it('实际表列 = Drizzle 列 = 白名单；不含任何出生信息字段', () => {
    const db = newDb();
    const actual = (
      db.$client.prepare('PRAGMA table_info(orders)').all() as { name: string }[]
    ).map((c) => c.name);
    const drizzleCols = Object.values(getTableColumns(orders)).map((c) => c.name);
    expect([...actual].sort()).toEqual([...ORDER_COLUMNS].sort());
    expect([...drizzleCols].sort()).toEqual([...ORDER_COLUMNS].sort());
    for (const bad of [
      'birth',
      'date',
      'time',
      'gender',
      'place',
      'pillar',
      'chart',
      'openid',
      'ip',
      'payload',
      'report',
    ]) {
      expect(
        // birth_fp 是 HMAC 指纹（不可逆、带密钥），不是出生信息，架构允许
        actual.filter((c) => c !== 'birth_fp').some((c) => c.includes(bad)),
        bad,
      ).toBe(false);
    }
  });
  it('数据库中只有 orders 一张业务表（另有迁移记录表）', () => {
    const db = newDb();
    const tables = (
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    expect(tables).toEqual(['orders', 'schema_migrations']);
  });
});

describe('订单号（128 位随机 → base62，22 位）', () => {
  it('格式、唯一性（20,000 个无重复）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const n = generateOrderNo();
      expect(n).toMatch(ORDER_NO_RE);
      set.add(n);
    }
    expect(set.size).toBe(20000);
  });
  it('熵：后 20 位字符分布接近均匀（卡方检验），首位受 128 位上限约束', () => {
    const counts = new Map<string, number>();
    const N = 20000;
    for (let i = 0; i < N; i++) {
      for (const ch of generateOrderNo().slice(2)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const total = N * 20;
    const expected = total / 62;
    const chi2 = [...counts.values()].reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(counts.size).toBe(62);
    // 自由度 61，p = 0.001 的临界值约 100.9
    expect(chi2).toBeLessThan(100.9);
    // 62^22 > 2^128 > 62^21：22 位足够容纳，且信息量 = 128 位
    expect(62n ** 22n > 2n ** 128n && 62n ** 21n < 2n ** 128n).toBe(true);
  });
  it('满足渠道要求：微信 6–32 位字母数字、支付宝 ≤ 64 位', () => {
    const n = generateOrderNo();
    expect(n.length).toBeGreaterThanOrEqual(6);
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n).toMatch(/^[0-9A-Za-z]+$/);
  });
});

describe('建单', () => {
  it('created、金额 990、texts_version 与指纹写入；不合法指纹拒绝', () => {
    const db = newDb();
    const o = order(db);
    expect(getOrder(db, o.orderNo)).toMatchObject({
      status: 'created',
      amountFen: 990,
      birthFp: FP,
      fpKeyId: 'k1',
      textsVersion: 1,
    });
    expect(() =>
      createOrder(db, { birthFp: 'xyz', fpKeyId: 'k1', textsVersion: 1, now: T0 }),
    ).toThrow(TypeError);
    expect(getOrder(db, 'not-an-order-no')).toBeNull();
    expect(getOrder(db, generateOrderNo())).toBeNull();
  });
  it('数据库层 CHECK：非法 status / channel 写不进去', () => {
    const db = newDb();
    const o = order(db);
    expect(() =>
      db.$client.prepare("UPDATE orders SET status = 'done' WHERE order_no = ?").run(o.orderNo),
    ).toThrow(/CHECK/);
    expect(() =>
      db.$client.prepare("UPDATE orders SET channel = 'paypal' WHERE order_no = ?").run(o.orderNo),
    ).toThrow(/CHECK/);
  });
});

describe('状态机：合法 / 非法迁移全覆盖', () => {
  it('迁移表：合法的只有 created→paid、created→closed、paid→refunded', () => {
    const legal = ORDER_STATUSES.flatMap((f) =>
      ORDER_STATUSES.filter((t) => canTransition(f, t)).map((t) => `${f}→${t}`),
    );
    expect(legal.sort()).toEqual(['created→closed', 'created→paid', 'paid→refunded']);
    expect(TRANSITIONS.closed).toEqual([]);
    expect(TRANSITIONS.refunded).toEqual([]);
  });

  /** 造一个处于指定状态的订单 */
  function at(db: OrdersDb, s: OrderStatus): string {
    const o = order(db);
    if (s === 'paid' || s === 'refunded') markPaid(db, paid(o.orderNo));
    if (s === 'refunded') markRefunded(db, o.orderNo, '用户申请退款', T0 + 120_000);
    if (s === 'closed') markClosed(db, o.orderNo, T0 + 1_800_000);
    return o.orderNo;
  }
  const ops: Record<'paid' | 'closed' | 'refunded', (db: OrdersDb, no: string) => unknown> = {
    paid: (db, no) => markPaid(db, paid(no, { channelTxnId: 'TXN-OTHER' })),
    closed: (db, no) => markClosed(db, no, T0 + 9e6),
    refunded: (db, no) => markRefunded(db, no, '重复下单', T0 + 9e6),
  };
  for (const from of ORDER_STATUSES) {
    for (const to of ['paid', 'closed', 'refunded'] as const) {
      const legal = canTransition(from, to);
      const idempotent = from === to; // 已在目标状态：closed / refunded 幂等返回 false；paid 换流水号则拒绝
      it(`${from} → ${to}：${legal ? '允许' : idempotent ? '幂等 / 拒绝' : '拒绝'}`, () => {
        const db = newDb();
        const no = at(db, from);
        const before = getOrder(db, no);
        if (legal) {
          ops[to](db, no);
          expect(getOrder(db, no)?.status).toBe(to);
        } else if (idempotent && to !== 'paid') {
          expect(ops[to](db, no)).toBe(false);
          expect(getOrder(db, no)).toEqual(before);
        } else {
          expect(codeOf(() => ops[to](db, no))).toBe('E_ILLEGAL_TRANSITION');
          expect(getOrder(db, no)).toEqual(before);
        }
      });
    }
  }
  it('不存在的订单 → E_ORDER_NOT_FOUND', () => {
    const db = newDb();
    expect(codeOf(() => markPaid(db, paid(generateOrderNo())))).toBe('E_ORDER_NOT_FOUND');
    expect(codeOf(() => markClosed(db, generateOrderNo(), T0))).toBe('E_ORDER_NOT_FOUND');
  });
});

describe('置 paid', () => {
  it('重复置 paid（回调 + 查单、或渠道重发）只生效一次，paidAt 不变', () => {
    const db = newDb();
    const o = order(db);
    expect(markPaid(db, paid(o.orderNo)).changed).toBe(true);
    const first = getOrder(db, o.orderNo);
    for (let i = 0; i < 5; i++)
      expect(markPaid(db, paid(o.orderNo, { now: T0 + 999_999 })).changed).toBe(false);
    expect(getOrder(db, o.orderNo)).toEqual(first);
    expect(first).toMatchObject({
      status: 'paid',
      channel: 'mock',
      channelTxnId: 'TXN-1',
      paidAt: T0 + 60_000,
    });
  });
  it('金额不符（含 1 分、9900、0）→ E_AMOUNT_MISMATCH，状态不变', () => {
    const db = newDb();
    const o = order(db);
    for (const amt of [1, 989, 991, 9900, 0, -990]) {
      expect(
        codeOf(() => markPaid(db, paid(o.orderNo, { amountFen: amt }))),
        String(amt),
      ).toBe('E_AMOUNT_MISMATCH');
    }
    expect(getOrder(db, o.orderNo)?.status).toBe('created');
  });
  it('已 paid 后换流水号再来 → 拒绝（疑似重复支付，人工处理）', () => {
    const db = newDb();
    const o = order(db);
    markPaid(db, paid(o.orderNo));
    expect(codeOf(() => markPaid(db, paid(o.orderNo, { channelTxnId: 'TXN-2' })))).toBe(
      'E_ILLEGAL_TRANSITION',
    );
  });
});

describe('退款原因不得含出生信息样式', () => {
  it('拒绝日期 / 时刻 / 8 位数字；空串与超长拒绝；正常原因写入', () => {
    const db = newDb();
    const o = order(db);
    markPaid(db, paid(o.orderNo));
    for (const r of [
      '用户 1987-06-15 出生',
      '1987年6月',
      '13:47 出生',
      '19870615',
      '',
      'x'.repeat(201),
    ]) {
      expect(
        codeOf(() => markRefunded(db, o.orderNo, r, T0)),
        r,
      ).toBe('E_REFUND_REASON');
    }
    expect(markRefunded(db, o.orderNo, '用户误购，原路退回', T0 + 1)).toBe(true);
    expect(getOrder(db, o.orderNo)).toMatchObject({
      status: 'refunded',
      refundReason: '用户误购，原路退回',
    });
  });
});

describe('数据库文件、WAL 与迁移', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  it('文件库开启 WAL；重复打开不重复执行迁移，数据保留', () => {
    const d = mkdtempSync(join(tmpdir(), 'orders-'));
    dirs.push(d);
    const path = join(d, 'orders.db');
    const db1 = openOrdersDb(path);
    expect(db1.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    const o = order(db1);
    db1.$client.close();
    const db2 = openOrdersDb(path);
    expect(runMigrations(db2.$client)).toEqual([]);
    expect(getOrder(db2, o.orderNo)?.status).toBe('created');
    expect(db2.$client.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: '0001_init.sql' },
    ]);
    db2.$client.close();
  });
  it('按 (status, created_at) 建索引（关单与清理任务用）', () => {
    const db = newDb();
    const idx = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='orders'")
      .all();
    expect(idx).toContainEqual({ name: 'idx_status_created' });
  });
});
