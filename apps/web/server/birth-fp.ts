/**
 * ④b 出生信息指纹（TASKS T41；ARCHITECTURE §4.4，PRD P0-8 / P0-10）。
 *
 * birth_fp = HMAC-SHA256(BIRTH_FP_KEY, "v1|" + canonical)，hex 存库，同时存 fp_key_id 以便将来轮换密钥。
 * - canonical 来自 @zhiming/core/birth 的 decodePayload（规范化后的载荷 JSON），同义写法得到同一指纹。
 * - 必须带密钥：出生信息空间只有约百万量级，普通哈希可被穷举反推。密钥只在 .env。
 * - 比较用 crypto.timingSafeEqual。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decodePayload, type PayloadErrorCode } from '@zhiming/core/birth';

export const FP_PREFIX = 'v1|';
/** 密钥至少 32 字节 */
export const MIN_KEY_BYTES = 32;
const KEY_ID_RE = /^[a-z0-9-]{1,32}$/;

export class FpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FpConfigError';
  }
}

export interface FpKey {
  key: Buffer;
  keyId: string;
}

/**
 * 从环境变量读取密钥：BIRTH_FP_KEY 为 hex（≥ 64 个十六进制字符）；BIRTH_FP_KEY_ID 如 "k1"。
 * 缺失或过短时抛错（启动期失败，不在运行时才发现）。错误信息不含密钥内容。
 */
export function loadFpKey(env: {
  BIRTH_FP_KEY?: string | undefined;
  BIRTH_FP_KEY_ID?: string | undefined;
}): FpKey {
  const raw = (env.BIRTH_FP_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) {
    throw new FpConfigError('BIRTH_FP_KEY 未设置或不是十六进制字符串');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length < MIN_KEY_BYTES)
    throw new FpConfigError(
      `BIRTH_FP_KEY 至少 ${MIN_KEY_BYTES} 字节（${MIN_KEY_BYTES * 2} 个十六进制字符）`,
    );
  const keyId = (env.BIRTH_FP_KEY_ID ?? '').trim();
  if (!KEY_ID_RE.test(keyId))
    throw new FpConfigError('BIRTH_FP_KEY_ID 未设置或格式不对（小写字母、数字、连字符，≤ 32 位）');
  return { key, keyId };
}

/** 对规范串求指纹（hex，64 位） */
export function birthFp(canonical: string, k: FpKey): string {
  return createHmac('sha256', k.key)
    .update(FP_PREFIX + canonical, 'utf8')
    .digest('hex');
}

/** 链接片段中的载荷 → 指纹；载荷不合法时返回错误码（不含输入） */
export function birthFpFromPayload(
  encoded: unknown,
  k: FpKey,
): { ok: true; fp: string; keyId: string } | { ok: false; code: PayloadErrorCode } {
  const d = decodePayload(encoded);
  if (!d.ok) return d;
  return { ok: true, fp: birthFp(d.canonical, k), keyId: k.keyId };
}

/** 常数时间比较指纹；任一方不是 64 位 hex 时返回 false */
export function fpEquals(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
