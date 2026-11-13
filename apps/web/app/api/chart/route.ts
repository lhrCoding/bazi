/** POST /api/chart —— 免费排盘（逻辑见 server/chart-api.ts） */
import { handleChart } from '../../../server/chart-api';
import { appLogger } from '../../../server/log';
import { createRateLimiter } from '../../../server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 每个 IP 每分钟 30 次（正常使用远低于此） */
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export function POST(req: Request): Promise<Response> {
  return handleChart(req, { limiter, logger: appLogger(), now: Date.now });
}
