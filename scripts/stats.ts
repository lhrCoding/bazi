/**
 * 运营统计命令行（TASKS T65）：npm run stats -- [--days 7] [--db 路径] [--log 应用日志文件 ...] [--alert]
 * - 订单库：--db，默认 DATABASE_PATH 或 apps/web/data/orders.db（只读打开）。
 * - 应用日志：--log 可多个（生产为容器 stdout 的落盘文件；Docker 化后见 T61）；不给则只统计订单。
 * - --alert：有异常时推送企业微信群机器人（ALERT_WEBHOOK_URL）。
 * 输出只有日期与计数，不含订单号、指纹、出生信息。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// 经 apps/web 的订单模块打开（使用 apps/web 依赖的 better-sqlite3，与网站同一份原生模块）
import { openOrdersDbReadonly } from '../apps/web/server/orders';
import {
  aggregate,
  dayRange,
  detectAnomalies,
  formatStats,
  pushAlert,
  readOrderTimes,
} from '../apps/web/server/stats';

function arg(name: string): string[] {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1] as string);
  });
  return out;
}

async function main(): Promise<void> {
  const days = Number(arg('days')[0] ?? 7);
  const dbPath =
    arg('db')[0] ??
    process.env.DATABASE_PATH ??
    join(import.meta.dirname, '..', 'apps', 'web', 'data', 'orders.db');
  const now = Date.now();
  const range = dayRange(now, days);
  const since = Date.parse(`${range[0]}T00:00:00+08:00`);
  let orders: ReturnType<typeof readOrderTimes> = [];
  if (existsSync(dbPath)) {
    const db = openOrdersDbReadonly(dbPath);
    orders = readOrderTimes(db, since);
    db.$client.close();
  } else console.error(`订单库不存在：${dbPath}（只统计日志）`);
  const logText = arg('log')
    .filter((p) => existsSync(p) || (console.error(`日志文件不存在：${p}`), false))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  const stats = aggregate(range, orders, logText);
  console.log(formatStats(stats));
  const alerts = detectAnomalies(stats);
  if (alerts.length > 0) console.log(`\n异常：\n  ${alerts.join('\n  ')}`);
  if (process.argv.includes('--alert') && alerts.length > 0) {
    const hook = process.env.ALERT_WEBHOOK_URL;
    if (!hook) console.error('未设置 ALERT_WEBHOOK_URL，未推送');
    else console.log((await pushAlert(hook, alerts)) ? '已推送企业微信' : '推送失败');
  }
}

void main();
