import { appLogger } from '../../../server/log';
import { handlePlaces } from '../../../server/places-api';
import { createRateLimiter } from '../../../server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 面板逐层浏览、边输入边搜索，上限比排盘宽
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export function GET(req: Request) {
  return handlePlaces(req, { limiter, logger: appLogger() });
}
