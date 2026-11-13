/**
 * ⑤ 订单存储与状态机（TASKS T42；ARCHITECTURE §4.5、§5.1）。
 *
 * - 订单号：crypto.randomBytes(16)（128 位）→ base62，定长 22 字符（不足左补 0）；同时作为支付渠道的商户订单号
 *   （微信 6–32 位字母数字、支付宝 ≤ 64 位）。
 * - 状态机集中校验：created → paid、created → closed（30 分钟未付）、paid → refunded（人工退款后标记）。
 * - 置 paid 幂等：已是 paid 且流水号相同 → 不重复生效；金额必须等于服务端写死的 990 分。
 *   每次状态变更都是带「WHERE status = 原状态」的单条 UPDATE，并发回调与查单同时到达也只生效一次。
 * - 退款原因由运营填写，规定不得写入出生信息：拒绝含日期 / 时刻样式的文字。
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { OrdersDb } from './db';
import { orders, type Channel, type OrderRow, type OrderStatus } from './schema';

export { openOrdersDb, runMigrations, type OrdersDb } from './db';
export {
  ORDER_COLUMNS,
  ORDER_STATUSES,
  CHANNELS,
  orders,
  type OrderRow,
  type OrderStatus,
  type Channel,
} from './schema';

/** 唯一商品「八字命盘报告」的价格：9.90 元 */
export const AMOUNT_FEN = 990;
export const ORDER_NO_LENGTH = 22;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateOrderNo(): string {
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`);
  let s = '';
  while (n > 0n) {
    s = BASE62[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s.padStart(ORDER_NO_LENGTH, '0');
}

export const ORDER_NO_RE = /^[0-9A-Za-z]{22}$/;

/** 合法状态迁移（集中定义） */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['paid', 'closed'],
  paid: ['refunded'],
  closed: [],
  refunded: [],
};

export type OrderErrorCode =
  'E_ORDER_NOT_FOUND' | 'E_ILLEGAL_TRANSITION' | 'E_AMOUNT_MISMATCH' | 'E_REFUND_REASON';

export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    readonly from?: OrderStatus,
    readonly to?: OrderStatus,
  ) {
    super(code);
    this.name = 'OrderError';
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new OrderError('E_ILLEGAL_TRANSITION', from, to);
}

export function getOrder(db: OrdersDb, orderNo: string): OrderRow | null {
  if (!ORDER_NO_RE.test(orderNo)) return null;
  return db.select().from(orders).where(eq(orders.orderNo, orderNo)).get() ?? null;
}

export function createOrder(
  db: OrdersDb,
  input: { birthFp: string; fpKeyId: string; textsVersion: number; now: number },
): OrderRow {
  if (!/^[0-9a-f]{64}$/.test(input.birthFp)) throw new TypeError('birthFp 必须是 64 位 hex');
  const row: OrderRow = {
    orderNo: generateOrderNo(),
    amountFen: AMOUNT_FEN,
    status: 'created',
    birthFp: input.birthFp,
    fpKeyId: input.fpKeyId,
    textsVersion: input.textsVersion,
    channel: null,
    channelTxnId: null,
    createdAt: input.now,
    paidAt: null,
    closedAt: null,
    refundedAt: null,
    refundReason: null,
  };
  db.insert(orders).values(row).run();
  return row;
}

function mustGet(db: OrdersDb, orderNo: string): OrderRow {
  const o = getOrder(db, orderNo);
  if (!o) throw new OrderError('E_ORDER_NOT_FOUND');
  return o;
}

/** 条件更新：只在当前状态为 from 时生效；返回是否生效 */
function transition(
  db: OrdersDb,
  orderNo: string,
  from: OrderStatus,
  set: Partial<OrderRow>,
): boolean {
  const r = db
    .update(orders)
    .set(set)
    .where(and(eq(orders.orderNo, orderNo), eq(orders.status, from)))
    .run();
  return r.changes === 1;
}

export interface PaidEvent {
  orderNo: string;
  amountFen: number;
  channel: Channel;
  channelTxnId: string;
  now: number;
}

/**
 * 置 paid（支付回调与主动查单共用，幂等）。返回 changed = 本次是否真正生效。
 * - 金额 ≠ 990 → E_AMOUNT_MISMATCH（不改状态，调用方告警）。
 * - 已是 paid：流水号相同 → changed = false；流水号不同 → E_ILLEGAL_TRANSITION（疑似重复支付，人工处理）。
 * - closed / refunded → E_ILLEGAL_TRANSITION。
 */
export function markPaid(db: OrdersDb, e: PaidEvent): { changed: boolean; order: OrderRow } {
  if (e.amountFen !== AMOUNT_FEN) throw new OrderError('E_AMOUNT_MISMATCH');
  return db.transaction(() => {
    const o = mustGet(db, e.orderNo);
    if (o.status === 'paid') {
      if (o.channelTxnId === e.channelTxnId && o.channel === e.channel)
        return { changed: false, order: o };
      throw new OrderError('E_ILLEGAL_TRANSITION', 'paid', 'paid');
    }
    assertTransition(o.status, 'paid');
    const ok = transition(db, e.orderNo, 'created', {
      status: 'paid',
      channel: e.channel,
      channelTxnId: e.channelTxnId,
      paidAt: e.now,
    });
    if (!ok) throw new OrderError('E_ILLEGAL_TRANSITION', o.status, 'paid');
    return { changed: true, order: mustGet(db, e.orderNo) };
  });
}

/** created → closed（30 分钟未付）；已 closed 时幂等返回 false */
export function markClosed(db: OrdersDb, orderNo: string, now: number): boolean {
  return db.transaction(() => {
    const o = mustGet(db, orderNo);
    if (o.status === 'closed') return false;
    assertTransition(o.status, 'closed');
    return transition(db, orderNo, 'created', { status: 'closed', closedAt: now });
  });
}

/** 退款原因里不允许出现日期 / 时刻样式（防止运营把出生信息写进库） */
const REASON_FORBIDDEN = /\d{4}\s*[-/.年]\s*\d{1,2}|\d{1,2}\s*[:：]\s*\d{2}|\d{8}/;
export const REFUND_REASON_MAX = 200;

/** paid → refunded（运营在渠道后台人工退款后执行）；已 refunded 时幂等返回 false */
export function markRefunded(db: OrdersDb, orderNo: string, reason: string, now: number): boolean {
  const r = reason.trim();
  if (r === '' || r.length > REFUND_REASON_MAX || REASON_FORBIDDEN.test(r))
    throw new OrderError('E_REFUND_REASON');
  return db.transaction(() => {
    const o = mustGet(db, orderNo);
    if (o.status === 'refunded') return false;
    assertTransition(o.status, 'refunded');
    return transition(db, orderNo, 'paid', {
      status: 'refunded',
      refundedAt: now,
      refundReason: r,
    });
  });
}
