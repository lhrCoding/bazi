-- 订单表（ARCHITECTURE §5.1，唯一一张业务表）。时间一律 Unix 毫秒。
-- 不存：出生日期 / 时间 / 性别 / 出生地（任何形式）、四柱、chart_key、报告正文、openid、IP。
CREATE TABLE orders (
  order_no       TEXT PRIMARY KEY NOT NULL,
  amount_fen     INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('created', 'paid', 'closed', 'refunded')),
  birth_fp       TEXT NOT NULL,
  fp_key_id      TEXT NOT NULL,
  texts_version  INTEGER NOT NULL,
  channel        TEXT CHECK (channel IS NULL OR channel IN ('wechat_jsapi', 'wechat_native', 'alipay_wap', 'alipay_page', 'mock')),
  channel_txn_id TEXT,
  created_at     INTEGER NOT NULL,
  paid_at        INTEGER,
  closed_at      INTEGER,
  refunded_at    INTEGER,
  refund_reason  TEXT
);
CREATE INDEX idx_status_created ON orders (status, created_at);
