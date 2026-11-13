/** POST /api/chart —— 免费排盘（逻辑见 server/chart-api.ts） */
import { handleChart } from '../../../server/chart-api';
import { appLogger } from '../../../server/log';
import { createRateLimiter } from '../../../server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 每个 IP 每分钟 30 次（正常使用远低于此） */
// 每 IP 每分钟 30 次；E2E 一次跑几十个命盘，由 playwright.config.ts 用 CHART_RATE_LIMIT 放宽（生产不设）
const limit = Number(process.env.CHART_RATE_LIMIT) || 30;
const limiter = createRateLimiter({ limit, windowMs: 60_000 });

export function POST(req: Request): Promise<Response> {
  return handleChart(req, { limiter, logger: appLogger(), now: Date.now });
}
