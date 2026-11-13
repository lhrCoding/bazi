/** POST /api/report —— 校验订单与指纹后拼装完整报告（逻辑见 server/report-api.ts） */
import { appContext, textsKeyOf } from '../../../server/app-context';
import { appLogger } from '../../../server/log';
import { createRateLimiter } from '../../../server/rate-limit';
import { handleReport } from '../../../server/report-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({
  limit: Number(process.env.REPORT_RATE_LIMIT) || 30,
  windowMs: 60_000,
});
const failures = new Map<string, { count: number; resetAt: number }>();

export function POST(req: Request) {
  const c = appContext();
  return handleReport(req, {
    db: c.db,
    fpKey: c.fpKey,
    texts: c.texts,
    textsKeyOf,
    resources: c.resources,
    limiter,
    failures,
    logger: appLogger(),
    now: Date.now,
  });
}
