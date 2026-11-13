/**
 * 报告 API POST /api/report {orderNo, payload}（TASKS T53；ARCHITECTURE §6.3）。
 *
 * ① 按订单号限流：同一订单号 1 小时内校验失败 ≥ 20 次即临时锁定（另有按 IP 的总限流）。
 * ② 订单不存在 / 未付款 / 已退款 / 指纹不符 → 统一 E_REPORT_LINK_INVALID（不区分原因，防止探测）。
 * ③ 指纹：HMAC(载荷规范串) 与订单 birth_fp 常数时间比较；订单的 fp_key_id 与当前密钥不一致时同样拒绝并告警。
 * ④ 排盘 + 规则，参考日期 = 订单创建时间；按订单 texts_version 取素材库拼装 → 同一订单任何时候打开都逐字相同。
 * ⑤ R-CHECK 不通过：告警（只记规则名、章节、槽位，不记正文）后放行。
 * 响应 {meta, chapters}，Cache-Control: no-store。不记录载荷与报告内容。
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { analyze, computeChart } from '@zhiming/core';
import { decodePayload, payloadToBirthInput } from '@zhiming/core/birth';
import { assembleReport, buildCtx, rcheck, type Report } from '@zhiming/core/report';
import { birthFp, fpEquals, type FpKey } from './birth-fp';
import { ApiError, handleApiError } from './errors';
import { getOrder, ORDER_NO_RE, type OrdersDb } from './orders';
import { clientIp, type RateLimiter } from './rate-limit';
import type { ReportResources } from './report-resources';
import type { TextsStore } from './texts-store';

export const FAIL_LIMIT = 20;
export const FAIL_WINDOW_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024;

export interface ReportDeps {
  db: OrdersDb;
  fpKey: FpKey;
  texts: TextsStore;
  textsKeyOf: (v: number) => string;
  resources: ReportResources;
  limiter: RateLimiter;
  /** 订单号 → 校验失败计数（进程内） */
  failures: Map<string, { count: number; resetAt: number }>;
  logger: Logger;
  now: () => number;
}

export type ReportResponse = Pick<Report, 'meta' | 'chapters'>;

const Body = z.strictObject({
  orderNo: z.string().regex(ORDER_NO_RE),
  payload: z.string().min(1).max(256),
});

function locked(deps: ReportDeps, orderNo: string, now: number): boolean {
  const f = deps.failures.get(orderNo);
  if (!f) return false;
  if (f.resetAt <= now) {
    deps.failures.delete(orderNo);
    return false;
  }
  return f.count >= FAIL_LIMIT;
}

function recordFailure(deps: ReportDeps, orderNo: string, now: number): void {
  const f = deps.failures.get(orderNo);
  if (!f || f.resetAt <= now)
    deps.failures.set(orderNo, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  else f.count++;
}

export async function handleReport(req: Request, deps: ReportDeps): Promise<Response> {
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
    const parsed = Body.safeParse(json);
    // 订单号格式不对也按「链接无效」处理，不暴露格式细节
    if (!parsed.success) throw new ApiError('E_REPORT_LINK_INVALID', 403);
    const { orderNo, payload } = parsed.data;
    const now = deps.now();
    if (locked(deps, orderNo, now)) throw new ApiError('E_RATE_LIMITED', 429);

    const order = getOrder(deps.db, orderNo);
    const d = decodePayload(payload);
    const ok =
      order !== null &&
      order.status === 'paid' &&
      d.ok &&
      order.fpKeyId === deps.fpKey.keyId &&
      fpEquals(birthFp(d.canonical, deps.fpKey), order.birthFp);
    if (!ok || !d.ok) {
      recordFailure(deps, orderNo, now);
      if (order && order.fpKeyId !== deps.fpKey.keyId)
        deps.logger.error({ orderNo, fpKeyId: order.fpKeyId }, 'fp key id mismatch');
      throw new ApiError('E_REPORT_LINK_INVALID', 403);
    }

    const library = deps.texts.libraries.get(deps.textsKeyOf(order.textsVersion));
    if (!library) {
      deps.logger.error({ orderNo, textsVersion: order.textsVersion }, 'texts version missing');
      throw new ApiError('E_INTERNAL', 500);
    }
    const chart = computeChart(payloadToBirthInput(d.payload), order.createdAt);
    const analysis = analyze(chart);
    const ctx = buildCtx(chart, analysis);
    const report = assembleReport({
      chart,
      analysis,
      ctx,
      library,
      glossary: deps.resources.glossary,
      textsVersion: deps.textsKeyOf(order.textsVersion),
      limitations: deps.resources.limitations,
    });
    const check = rcheck(report, ctx, deps.resources.words);
    if (!check.passed)
      deps.logger.warn(
        {
          orderNo,
          rcheck: check.failures
            .slice(0, 20)
            .map((f) => ({ rule: f.rule, chapter: f.chapter, slot: f.slot })),
        },
        'rcheck failed (served)',
      );
    const body: ReportResponse = { meta: report.meta, chapters: report.chapters };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleApiError(e, deps.logger, 'api/report');
  }
}
