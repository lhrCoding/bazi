/**
 * 运营统计（TASKS T65）：按天（北京时间）统计订单创建 / 支付 / 退款（订单库）、免费排盘次数（应用日志 evt=chart）、
 * 转化率、报告兜底素材 / 空槽位 / R-CHECK 不通过次数（应用日志 evt=report / rcheck_failed）、错误日志条数。
 * 异常时推送企业微信群机器人（ALERT_WEBHOOK_URL；fetch 可注入，测试用 mock）。
 *
 * 输出只有日期与计数：不含订单号、指纹、出生信息（测试断言）。
 * 原计划从 Caddy 访问日志计 POST /api/chart；Caddy 随 T61 延后，改为应用日志计数事件（不含任何输入）。
 */
import type { OrdersDb } from './orders';

export interface DayStats {
  day: string;
  created: number;
  paid: number;
  refunded: number;
  charts: number;
  reports: number;
  fallback: number;
  slotEmpty: number;
  rcheckFailed: number;
  errors: number;
}

const DAY_MS = 86_400_000;
const CN_OFFSET_MS = 8 * 3600 * 1000;

/** Unix 毫秒 → 北京时间日期 YYYY-MM-DD */
export const dayOf = (ms: number): string => new Date(ms + CN_OFFSET_MS).toISOString().slice(0, 10);

const empty = (day: string): DayStats => ({
  day,
  created: 0,
  paid: 0,
  refunded: 0,
  charts: 0,
  reports: 0,
  fallback: 0,
  slotEmpty: 0,
  rcheckFailed: 0,
  errors: 0,
});

/** 最近 days 天（含 now 当天），按日期升序 */
export function dayRange(now: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY_MS));
}

export interface OrderTimes {
  createdAt: number;
  paidAt: number | null;
  refundedAt: number | null;
}

export function readOrderTimes(db: OrdersDb, since: number): OrderTimes[] {
  return db.$client
    .prepare(
      `SELECT created_at AS createdAt, paid_at AS paidAt, refunded_at AS refundedAt FROM orders
       WHERE created_at >= ? OR paid_at >= ? OR refunded_at >= ?`,
    )
    .all(since, since, since) as OrderTimes[];
}

export function aggregate(
  days: readonly string[],
  orders: readonly OrderTimes[],
  logText: string,
): DayStats[] {
  const map = new Map(days.map((d) => [d, empty(d)]));
  const at = (ms: number | null | undefined): DayStats | undefined =>
    typeof ms === 'number' ? map.get(dayOf(ms)) : undefined;
  for (const o of orders) {
    const c = at(o.createdAt);
    if (c) c.created++;
    const p = at(o.paidAt);
    if (p) p.paid++;
    const r = at(o.refundedAt);
    if (r) r.refunded++;
  }
  for (const line of logText.split('\n')) {
    if (!line.startsWith('{')) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const d = at(typeof j.time === 'number' ? j.time : null);
    if (!d) continue;
    if (j.evt === 'chart') d.charts++;
    else if (j.evt === 'report') {
      d.reports++;
      d.fallback += typeof j.fallback === 'number' ? j.fallback : 0;
      d.slotEmpty += typeof j.slotEmpty === 'number' ? j.slotEmpty : 0;
    } else if (j.evt === 'rcheck_failed') d.rcheckFailed++;
    if (j.level === 'error' || j.level === 'fatal') d.errors++;
  }
  return [...map.values()];
}

export const conversion = (s: DayStats): string =>
  s.charts === 0 ? '—' : `${((s.paid / s.charts) * 100).toFixed(1)}%`;

export interface AlertRules {
  /** 当天下单数 ≥ 此值却没有一笔支付 → 疑似支付故障 */
  unpaidCreatedMin: number;
  /** 当天错误日志条数 ≥ 此值 */
  errorsMin: number;
}
export const DEFAULT_ALERT_RULES: AlertRules = { unpaidCreatedMin: 5, errorsMin: 1 };

/** 只看最后一天（今天）；返回告警文字（不含任何个人信息） */
export function detectAnomalies(stats: readonly DayStats[], rules = DEFAULT_ALERT_RULES): string[] {
  const t = stats.at(-1);
  if (!t) return [];
  const out: string[] = [];
  if (t.created >= rules.unpaidCreatedMin && t.paid === 0)
    out.push(`${t.day} 下单 ${t.created} 笔但支付 0 笔，请检查支付渠道`);
  if (t.errors >= rules.errorsMin) out.push(`${t.day} 应用错误日志 ${t.errors} 条`);
  if (t.rcheckFailed > 0)
    out.push(`${t.day} 报告检查（R-CHECK）不通过 ${t.rcheckFailed} 次（已放行）`);
  if (t.slotEmpty > 0) out.push(`${t.day} 报告空槽位 ${t.slotEmpty} 次（素材缺口）`);
  return out;
}

export function formatStats(stats: readonly DayStats[]): string {
  const head = [
    '日期',
    '排盘',
    '下单',
    '支付',
    '退款',
    '转化',
    '报告',
    '兜底',
    '空槽',
    '检查告警',
    '错误',
  ];
  const rows = stats.map((s) => [
    s.day,
    s.charts,
    s.created,
    s.paid,
    s.refunded,
    conversion(s),
    s.reports,
    s.fallback,
    s.slotEmpty,
    s.rcheckFailed,
    s.errors,
  ]);
  const sum = (k: keyof DayStats) => stats.reduce((a, s) => a + (s[k] as number), 0);
  const total = {
    ...empty('合计'),
    charts: sum('charts'),
    paid: sum('paid'),
  };
  rows.push([
    '合计',
    sum('charts'),
    sum('created'),
    sum('paid'),
    sum('refunded'),
    conversion(total),
    sum('reports'),
    sum('fallback'),
    sum('slotEmpty'),
    sum('rcheckFailed'),
    sum('errors'),
  ]);
  return [head, ...rows].map((r) => r.join('\t')).join('\n');
}

/** 企业微信群机器人文本消息 */
export async function pushAlert(
  webhook: string,
  lines: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (lines.length === 0) return false;
  const res = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content: `【知命 运营告警】\n${lines.join('\n')}` },
    }),
  });
  return res.ok;
}
