/**
 * 免费排盘接口逻辑（TASKS T43；路由 app/api/chart/route.ts 只做转发，便于测试注入限流器 / 时钟 / 日志）。
 *
 * 请求体：{ "payload": "<Base64url 载荷>" }（载荷来自页面 URL 的 # 片段，片段本身不发给服务器）。
 * 流程：限流 → 读请求体（≤ 1 KB）→ 结构校验 → 解码载荷 → 排盘（参考日期 = 当前时间）→ 规则 → buildFreeResult。
 * 不落库、不记请求体；错误只返回错误码（server/errors.ts）。
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { analyze, computeChart } from '@zhiming/core';
import { decodePayload, payloadToBirthInput, PayloadError } from '@zhiming/core/birth';
import { findPlace } from '@zhiming/core/geo';
import { buildFreeResult } from '@zhiming/core/report';
import { ApiError, handleApiError } from './errors';
import { clientIp, type RateLimiter } from './rate-limit';

export const MAX_BODY_BYTES = 1024;
const BodySchema = z.strictObject({ payload: z.string().min(1).max(256) });

export interface ChartDeps {
  limiter: RateLimiter;
  logger: Logger;
  now: () => number;
}

export async function handleChart(req: Request, deps: ChartDeps): Promise<Response> {
  try {
    if (!deps.limiter.hit(clientIp(req.headers))) throw new ApiError('E_RATE_LIMITED', 429);
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new ApiError('E_BAD_REQUEST', 413);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError('E_BAD_REQUEST', 400);
    }
    const body = BodySchema.parse(json);
    const d = decodePayload(body.payload);
    if (!d.ok) throw new PayloadError(d.code);
    const input = payloadToBirthInput(d.payload);
    const now = deps.now();
    const chart = computeChart(input, now);
    // 交节日无时辰：另排「之前 / 之后」两盘，结果页按钮上直接写出对应年月柱（UI.md §5.3）
    const jieqiAlt =
      !chart.hourKnown && chart.jieqi_on_birthday
        ? {
            before: computeChart({ ...input, jieqiChoice: 'before' }, now),
            after: computeChart({ ...input, jieqiChoice: 'after' }, now),
          }
        : undefined;
    const placeName = input.placeCode ? (findPlace(input.placeCode)?.name ?? null) : null;
    const result = buildFreeResult(chart, analyze(chart), { jieqiAlt, placeName });
    // 运营统计（T65）：只记一条计数事件，不含任何输入
    deps.logger.info({ evt: 'chart' }, 'chart');
    return Response.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    return handleApiError(e, deps.logger, 'api/chart');
  }
}
