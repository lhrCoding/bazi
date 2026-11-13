/**
 * 统一错误码与 API 错误响应（TASKS T41；ARCHITECTURE §4.1「错误一律用错误码」、§6.4）。
 *
 * 响应体：{ "error": { "code": "E_…", "message": "固定中文提示" } }。message 只按错误码取，**永远不回显输入**。
 * - BaziError / PayloadError：用各自的错误码与提示，HTTP 400。
 * - ZodError（请求体结构不对）：先映射为 E_INVALID_INPUT 再记录与返回（Zod 的默认 message 带收到的值）。
 * - ApiError：业务错误（订单不存在、指纹不符等），带自己的状态码。
 * - 其余：E_INTERNAL，HTTP 500，只记错误名与调用栈位置。
 */
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { BAZI_ERROR_MESSAGES, BaziError, type BaziErrorCode } from '@zhiming/core';
import { PAYLOAD_ERROR_MESSAGES, PayloadError, type PayloadErrorCode } from '@zhiming/core/birth';

export const API_ERROR_MESSAGES = {
  E_BAD_REQUEST: '请求格式不正确，请刷新页面后重试。',
  E_NOT_FOUND: '未找到对应的内容。',
  E_ORDER_NOT_FOUND: '未找到这个订单，请检查链接是否完整。',
  E_ORDER_NOT_PAID: '订单尚未支付完成。',
  E_ORDER_REFUNDED: '该订单已退款，报告链接已失效。',
  E_FP_MISMATCH: '链接中的出生信息与订单不一致，请使用付款后收到的完整链接。',
  E_RATE_LIMITED: '请求过于频繁，请稍后再试。',
  E_INTERNAL: '服务暂时出了点问题，请稍后再试。',
} as const;
export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES;

export type ErrorCode = ApiErrorCode | BaziErrorCode | PayloadErrorCode | 'E_INVALID_INPUT';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
  ) {
    super(API_ERROR_MESSAGES[code]);
    this.name = 'ApiError';
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** 错误 → HTTP 状态码 + 响应体（不含任何输入） */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ApiError)
    return {
      status: err.status,
      body: { error: { code: err.code, message: API_ERROR_MESSAGES[err.code] } },
    };
  if (err instanceof BaziError)
    return {
      status: 400,
      body: { error: { code: err.code, message: BAZI_ERROR_MESSAGES[err.code] } },
    };
  if (err instanceof PayloadError)
    return {
      status: 400,
      body: { error: { code: err.code, message: PAYLOAD_ERROR_MESSAGES[err.code] } },
    };
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: { error: { code: 'E_INVALID_INPUT', message: BAZI_ERROR_MESSAGES.E_INVALID_INPUT } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'E_INTERNAL', message: API_ERROR_MESSAGES.E_INTERNAL } },
  };
}

/**
 * Route Handler 统一出口：记录（4xx 记 warn、5xx 记 error，均只记错误码与安全序列化）并返回 JSON 响应。
 * @param route 路由名（如 "api/chart"），用于日志定位
 */
export function handleApiError(err: unknown, logger: Logger, route: string): Response {
  const { status, body } = toErrorResponse(err);
  // 原始错误交给 logger 的 err 序列化器（serializeError）处理；先序列化再交出会被二次序列化而丢失 issues
  const entry = { route, status, code: body.error.code, err };
  if (status >= 500) logger.error(entry, 'api_error');
  else logger.warn(entry, 'api_error');
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
