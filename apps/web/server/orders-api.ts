/**
 * 订单 API（TASKS T47；ARCHITECTURE §4.8、§6.2）。路由文件只做转发，依赖由调用方注入，便于测试。
 *
 * - POST /api/orders {payload, channel}：规范化 → 排盘校验 → 指纹 → 建单（created、990、texts_version = 当前发布版）
 *   → 渠道下单 → {orderNo, pay}。发给渠道的参数里只有订单号、金额、固定描述、地址、IP。
 * - GET /api/orders/<订单号>/status：只返回状态；建单 10 秒后仍未收到回调，则向渠道主动查单（同一订单 5 秒内最多查一次）。
 * - POST /api/pay/notify/<渠道>：验签 → 金额 = 990 → 幂等置 paid；重复回调只生效一次。
 * 不记录载荷与出生信息；日志只有订单号、渠道、错误码。
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { computeChart } from '@zhiming/core';
import { decodePayload, payloadToBirthInput, PayloadError } from '@zhiming/core/birth';
import { birthFp, type FpKey } from './birth-fp';
import { ApiError, handleApiError } from './errors';
import { AMOUNT_FEN, createOrder, getOrder, markPaid, OrderError, type OrdersDb } from './orders';
import { CHANNELS, type Channel } from './orders/schema';
import { PAY_DESCRIPTION, type PaymentProvider } from './payment/types';
import { clientIp, type RateLimiter } from './rate-limit';

export const QUERY_AFTER_MS = 10_000;
export const QUERY_MIN_INTERVAL_MS = 5_000;
const MAX_BODY_BYTES = 1024;

export interface OrdersDeps {
  db: OrdersDb;
  fpKey: FpKey;
  /** 新订单使用的素材库版本（开发模式为 0） */
  textsVersion: () => number;
  providers: Partial<Record<Channel, PaymentProvider>>;
  limiter: RateLimiter;
  logger: Logger;
  now: () => number;
  siteUrl: string;
  /** 订单号 → 上次主动查单时间（进程内） */
  lastQuery?: Map<string, number>;
}

const CreateBody = z.strictObject({
  payload: z.string().min(1).max(256),
  channel: z.enum(CHANNELS),
});

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new ApiError('E_BAD_REQUEST', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('E_BAD_REQUEST', 400);
  }
}

export async function handleCreateOrder(req: Request, deps: OrdersDeps): Promise<Response> {
  try {
    const ip = clientIp(req.headers);
    if (!deps.limiter.hit(ip)) throw new ApiError('E_RATE_LIMITED', 429);
    const body = CreateBody.parse(await readJson(req));
    const provider = deps.providers[body.channel];
    if (!provider) throw new ApiError('E_CHANNEL_UNAVAILABLE', 400);
    const d = decodePayload(body.payload);
    if (!d.ok) throw new PayloadError(d.code);
    const now = deps.now();
    computeChart(payloadToBirthInput(d.payload), now); // 只校验输入可排盘；不合法抛 BaziError
    const order = createOrder(deps.db, {
      birthFp: birthFp(d.canonical, deps.fpKey),
      fpKeyId: deps.fpKey.keyId,
      textsVersion: deps.textsVersion(),
      now,
      channel: body.channel,
    });
    const pay = await provider.createPayment({
      orderNo: order.orderNo,
      amountFen: AMOUNT_FEN,
      description: PAY_DESCRIPTION,
      notifyUrl: new URL(`/api/pay/notify/${body.channel}`, deps.siteUrl).toString(),
      returnUrl: new URL(`/pay/done?o=${order.orderNo}`, deps.siteUrl).toString(),
      clientIp: ip,
      openid: null,
    });
    // mock 自动支付：按真实回调流程立即置 paid
    const auto = provider.autoComplete?.(order.orderNo);
    if (auto) await handleNotify(body.channel, auto, deps);
    return Response.json(
      { orderNo: order.orderNo, pay },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return handleApiError(e, deps.logger, 'api/orders');
  }
}

/** 置 paid 并记日志（回调与查单共用）。金额不符等异常记 error 告警，不抛给渠道。 */
function applyPaid(
  deps: OrdersDeps,
  channel: Channel,
  p: { orderNo: string; amountFen: number; channelTxnId: string },
  via: 'notify' | 'query',
): boolean {
  try {
    const r = markPaid(deps.db, { ...p, channel, now: deps.now() });
    if (r.changed) deps.logger.info({ orderNo: p.orderNo, channel, via }, 'order paid');
    return true;
  } catch (e) {
    if (e instanceof OrderError) {
      deps.logger.error({ orderNo: p.orderNo, channel, via, code: e.code }, 'pay event rejected');
      return e.code !== 'E_ORDER_NOT_FOUND';
    }
    throw e;
  }
}

export async function handleOrderStatus(
  orderNo: string,
  req: Request,
  deps: OrdersDeps,
): Promise<Response> {
  try {
    if (!deps.limiter.hit(clientIp(req.headers))) throw new ApiError('E_RATE_LIMITED', 429);
    let o = getOrder(deps.db, orderNo);
    if (!o) throw new ApiError('E_ORDER_NOT_FOUND', 404);
    const now = deps.now();
    const provider = o.channel ? deps.providers[o.channel] : undefined;
    if (o.status === 'created' && provider && now - o.createdAt >= QUERY_AFTER_MS) {
      const last = deps.lastQuery?.get(orderNo) ?? 0;
      if (now - last >= QUERY_MIN_INTERVAL_MS) {
        deps.lastQuery?.set(orderNo, now);
        const paid = await provider.queryOrder(orderNo);
        if (paid && paid.orderNo === orderNo) {
          applyPaid(deps, provider.channel, paid, 'query');
          o = getOrder(deps.db, orderNo) ?? o;
        }
      }
    }
    return Response.json({ status: o.status }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleApiError(e, deps.logger, 'api/orders/status');
  }
}

export async function handleNotify(
  channel: string,
  req: Request,
  deps: OrdersDeps,
): Promise<Response> {
  const provider = (CHANNELS as readonly string[]).includes(channel)
    ? deps.providers[channel as Channel]
    : undefined;
  if (!provider) return new Response(null, { status: 404 });
  const r = await provider.verifyNotify(req);
  if (!r.paid) {
    deps.logger.warn({ channel }, 'notify verify failed');
    return r.ack(false);
  }
  return r.ack(applyPaid(deps, provider.channel, r.paid, 'notify'));
}
