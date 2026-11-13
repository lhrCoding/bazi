/**
 * 订单表 Drizzle 定义（ARCHITECTURE §5.1）。DDL 以 migrations/0001_init.sql 为准，
 * test/orders.test.ts 断言：Drizzle 列 = 实际表列 = 列名白名单 ORDER_COLUMNS（新增列必须同时改白名单并说明理由）。
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ORDER_STATUSES = ['created', 'paid', 'closed', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const CHANNELS = [
  'wechat_jsapi',
  'wechat_native',
  'alipay_wap',
  'alipay_page',
  'mock',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const orders = sqliteTable(
  'orders',
  {
    orderNo: text('order_no').primaryKey(), // 128 位随机，base62；也是商户订单号
    amountFen: integer('amount_fen').notNull(), // 990，服务端写死
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    birthFp: text('birth_fp').notNull(), // HMAC-SHA256(BIRTH_FP_KEY, "v1|" + canonical) hex
    fpKeyId: text('fp_key_id').notNull(),
    textsVersion: integer('texts_version').notNull(), // 素材库发布版本，重看时用同版本拼装
    channel: text('channel', { enum: CHANNELS }),
    channelTxnId: text('channel_txn_id'), // 渠道交易流水号（对账、人工退款用）
    createdAt: integer('created_at').notNull(), // 也是报告的参考日期
    paidAt: integer('paid_at'),
    closedAt: integer('closed_at'),
    refundedAt: integer('refunded_at'),
    refundReason: text('refund_reason'), // 运营填写，规定不得写入出生信息
  },
  (t) => [index('idx_status_created').on(t.status, t.createdAt)],
);

export type OrderRow = typeof orders.$inferSelect;

/** 列名白名单（ARCHITECTURE §5.1「表结构评审」）：不含任何出生信息字段 */
export const ORDER_COLUMNS = [
  'order_no',
  'amount_fen',
  'status',
  'birth_fp',
  'fp_key_id',
  'texts_version',
  'channel',
  'channel_txn_id',
  'created_at',
  'paid_at',
  'closed_at',
  'refunded_at',
  'refund_reason',
] as const;
