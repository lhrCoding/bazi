/**
 * 应用日志（TASKS T41；ARCHITECTURE §6.4「日志里为什么不会出现出生信息」）。
 *
 * - pino JSON 行日志；全局约定：**不记录请求体**（调用方不得把 body / 载荷传给 logger）。
 * - redact 兜底：payload / birth / b / body / canonical / input 等键（顶层与一层嵌套）以及 cookie 一律替换为 [REDACTED]。
 * - 错误序列化（serializeError）：只记 name、code 与调用栈中的代码位置行，**不记 message**——第三方库与 Zod 的
 *   message 可能带上收到的值（Zod 默认如此，是最容易漏的地方）。ZodError 只记每个问题的字段路径与问题类型。
 * - fallback_used / rcheck_failed 等事件只记槽位 id 与版本号，不记 chart_key 或四柱（由调用方遵守，见 safeEvent）。
 */
import pino, { type DestinationStream, type Logger } from 'pino';
import { ZodError } from 'zod';

export const REDACT_KEYS = [
  'payload',
  'birth',
  'b',
  'body',
  'canonical',
  'input',
  'chartKey',
  'chart_key',
  'pillars',
];
export const REDACT_PATHS = [
  ...REDACT_KEYS,
  ...REDACT_KEYS.map((k) => `*.${k}`),
  'cookie',
  'headers.cookie',
  '*.headers.cookie',
  'req.headers.cookie',
];

export interface SafeError {
  name: string;
  code?: string;
  /** ZodError：每个问题的字段路径与问题类型（不含收到的值） */
  issues?: { path: string; code: string }[];
  /** 调用栈中的代码位置行（去掉首行 message） */
  stack?: string[];
}

/** 已经序列化过的 SafeError（普通对象，有字符串 name，且只含已知字段）：重复调用时原样返回 */
function isSafeError(x: unknown): x is SafeError {
  if (typeof x !== 'object' || x === null || x instanceof Error) return false;
  const o = x as Record<string, unknown>;
  // 收紧：普通对象碰巧带 name / stack 时不能借此把任意内容原样写进日志
  const shapeOk =
    typeof o.name === 'string' &&
    /^[A-Za-z]{1,40}$/.test(o.name) &&
    Object.keys(o).every((k) => ['name', 'code', 'issues', 'stack'].includes(k));
  const codeOk =
    o.code === undefined || (typeof o.code === 'string' && /^E_[A-Z_]{1,40}$/.test(o.code));
  const stackOk =
    o.stack === undefined ||
    (Array.isArray(o.stack) && o.stack.every((l) => typeof l === 'string' && l.startsWith('at ')));
  const issuesOk =
    o.issues === undefined ||
    (Array.isArray(o.issues) &&
      o.issues.every(
        (i) =>
          typeof i === 'object' &&
          i !== null &&
          Object.keys(i).every((k) => k === 'path' || k === 'code') &&
          /^[A-Za-z0-9_.]*$/.test(String((i as { path?: unknown }).path ?? '')),
      ));
  return shapeOk && codeOk && stackOk && issuesOk;
}

export function serializeError(err: unknown): SafeError {
  if (isSafeError(err)) return err;
  if (err instanceof ZodError) {
    return {
      name: 'ZodError',
      code: 'E_INVALID_INPUT',
      issues: err.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    };
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const frames = (err.stack ?? '')
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('at '))
      .slice(0, 10);
    return {
      name: err.name,
      ...(typeof code === 'string' ? { code } : {}),
      ...(frames.length ? { stack: frames } : {}),
    };
  }
  return { name: typeof err };
}

export function createLogger(destination?: DestinationStream, level = 'info'): Logger {
  return pino(
    {
      level,
      base: null,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { err: serializeError, error: serializeError },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}

/** 事件日志：只允许标量字段（槽位 id、版本号、错误码、计数），防止把对象（如 ctx、报告）整个写进日志 */
export function safeEvent(
  logger: Logger,
  event: string,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): void {
  logger.info({ event, ...fields });
}

let shared: Logger | null = null;
/** 进程级日志实例（stdout） */
export function appLogger(): Logger {
  shared ??= createLogger();
  return shared;
}
