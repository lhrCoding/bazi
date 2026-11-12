/**
 * 出生信息载荷 v1（TASKS T39；ARCHITECTURE §4.4，PRD P0-8 / P0-10 / Q11）。
 *
 * 载荷 = 紧凑 JSON，键顺序固定：{"v":1,"c":"s","d":"1994-01-09","lp":0,"t":"14:30","g":"f","p":"110105","j":null}
 *   c 公历 s / 农历 l；lp 闰月 0 / 1（仅农历）；t 'HH:MM' 或 null（不知道时辰）；g 男 m / 女 f；
 *   p 出生地代码或 null；j 交节日无时辰时的选择 before / after / unsure 或 null。
 * 编码：ASCII JSON → Base64url（无填充），约 100 字符。**只编码不加密**（PRD Q11，用户已确认风险）。
 *
 * 规范化（canonical）：解析 → 校验 → 按固定键序重新序列化。同义的不同写法得到同一规范串（指纹基于它）：
 *   键顺序与空白无关；lp / p / j 缺省 → 0 / null / null；lp 写 true / false 等同 1 / 0；时间 9:05 → 09:05；
 *   知道时辰时 j 不起作用，规范为 null。公历带 lp = 1 视为非法。
 * 错误只返回错误码，**错误对象中不含任何输入片段**（防止出生信息进日志）。
 * core 不使用 Buffer / TextEncoder：载荷全部是 ASCII，Base64url 在此自行实现，非 ASCII 一律拒绝。
 */
import type { BirthInput } from '../bazi/types';

export const PAYLOAD_VERSION = 1;
/** 编码后长度上限（正常约 100 字符） */
export const MAX_ENCODED_LENGTH = 200;

export interface PayloadV1 {
  v: 1;
  c: 's' | 'l';
  d: string;
  lp: 0 | 1;
  t: string | null;
  g: 'm' | 'f';
  p: string | null;
  j: 'before' | 'after' | 'unsure' | null;
}

export type PayloadErrorCode =
  | 'E_PAYLOAD_TOO_LONG'
  | 'E_PAYLOAD_ENCODING'
  | 'E_PAYLOAD_JSON'
  | 'E_PAYLOAD_VERSION'
  | 'E_PAYLOAD_INVALID';

/** 只带错误码与固定说明，不带输入 */
export class PayloadError extends Error {
  constructor(readonly code: PayloadErrorCode) {
    super(PAYLOAD_ERROR_MESSAGES[code]);
    this.name = 'PayloadError';
  }
}

export const PAYLOAD_ERROR_MESSAGES: Readonly<Record<PayloadErrorCode, string>> = {
  E_PAYLOAD_TOO_LONG: '链接中的出生信息过长',
  E_PAYLOAD_ENCODING: '链接中的出生信息编码不正确',
  E_PAYLOAD_JSON: '链接中的出生信息格式不正确',
  E_PAYLOAD_VERSION: '链接版本不受支持',
  E_PAYLOAD_INVALID: '链接中的出生信息不完整或不合法',
};

export type DecodeResult =
  { ok: true; payload: PayloadV1; canonical: string } | { ok: false; code: PayloadErrorCode };

// ---------------------------------------------------------------- Base64url（ASCII）

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  [...ALPHABET].map((c, i) => [c, i]),
);

export function base64urlEncodeAscii(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) throw new PayloadError('E_PAYLOAD_ENCODING');
    bytes.push(c);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i] as number, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    if (b !== undefined) out += ALPHABET[(n >> 6) & 63];
    if (c !== undefined) out += ALPHABET[n & 63];
  }
  return out;
}

/** 解码失败（含非法字符、长度余 1、非 ASCII 字节、多余的尾部位）抛 E_PAYLOAD_ENCODING */
export function base64urlDecodeAscii(s: string): string {
  if (s.length % 4 === 1) throw new PayloadError('E_PAYLOAD_ENCODING');
  let out = '';
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    const v = [...chunk].map((ch) => INDEX[ch]);
    if (v.some((x) => x === undefined)) throw new PayloadError('E_PAYLOAD_ENCODING');
    const [a, b, c, d] = v as (number | undefined)[];
    const n = ((a as number) << 18) | ((b as number) << 12) | ((c ?? 0) << 6) | (d ?? 0);
    const bytes = [(n >> 16) & 255];
    if (c !== undefined) bytes.push((n >> 8) & 255);
    if (d !== undefined) bytes.push(n & 255);
    // 规范编码：未用到的尾部位必须为 0（同一内容只有一种编码）
    if (c === undefined && ((n >> 8) & 255) !== 0) throw new PayloadError('E_PAYLOAD_ENCODING');
    if (c !== undefined && d === undefined && (n & 255) !== 0)
      throw new PayloadError('E_PAYLOAD_ENCODING');
    for (const byte of bytes) {
      if (byte > 0x7f) throw new PayloadError('E_PAYLOAD_ENCODING');
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 规范化与校验

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const PLACE_RE = /^[0-9A-Za-z_-]{1,32}$/;
const KEYS = ['v', 'c', 'd', 'lp', 't', 'g', 'p', 'j'] as const;

function fail(): never {
  throw new PayloadError('E_PAYLOAD_INVALID');
}

/** 任意 JSON 值 → 规范载荷；不合法抛 PayloadError（不含输入） */
export function normalizePayload(raw: unknown): PayloadV1 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail();
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(KEYS as readonly string[]).includes(k))) fail();
  if (o.v !== PAYLOAD_VERSION) throw new PayloadError('E_PAYLOAD_VERSION');

  if (o.c !== 's' && o.c !== 'l') fail();
  const dm = typeof o.d === 'string' ? DATE_RE.exec(o.d) : null;
  if (!dm) fail();
  const [y, mo, da] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || da < 1 || da > (o.c === 'l' ? 30 : 31)) fail();

  const lpRaw = o.lp ?? 0;
  const lp = lpRaw === 1 || lpRaw === true ? 1 : lpRaw === 0 || lpRaw === false ? 0 : fail();
  if (o.c === 's' && lp === 1) fail();

  let t: string | null = null;
  if (o.t !== null && o.t !== undefined) {
    const tm = typeof o.t === 'string' ? TIME_RE.exec(o.t) : null;
    if (!tm) fail();
    const [h, mi] = [Number(tm[1]), Number(tm[2])];
    if (h > 23 || mi > 59) fail();
    t = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  if (o.t === undefined) fail(); // t 必须显式给出（null 表示不知道时辰），避免把「漏传」当成「不知道」

  if (o.g !== 'm' && o.g !== 'f') fail();
  const p = o.p ?? null;
  if (p !== null && (typeof p !== 'string' || !PLACE_RE.test(p))) fail();
  const jRaw = o.j ?? null;
  if (jRaw !== null && jRaw !== 'before' && jRaw !== 'after' && jRaw !== 'unsure') fail();

  return {
    v: 1,
    c: o.c,
    d: dm[0],
    lp,
    t,
    g: o.g,
    p: p as string | null,
    j: t === null ? (jRaw as PayloadV1['j']) : null,
  };
}

/** 固定键序的紧凑 JSON */
export function canonicalJson(p: PayloadV1): string {
  return `{"v":1,"c":"${p.c}","d":"${p.d}","lp":${p.lp},"t":${p.t === null ? 'null' : `"${p.t}"`},"g":"${p.g}","p":${
    p.p === null ? 'null' : `"${p.p}"`
  },"j":${p.j === null ? 'null' : `"${p.j}"`}}`;
}

export function encodePayload(p: PayloadV1): string {
  return base64urlEncodeAscii(canonicalJson(normalizePayload(p)));
}

/** 链接片段 → 规范载荷；失败只给错误码 */
export function decodePayload(encoded: unknown): DecodeResult {
  try {
    if (typeof encoded !== 'string' || encoded.length === 0)
      return { ok: false, code: 'E_PAYLOAD_ENCODING' };
    if (encoded.length > MAX_ENCODED_LENGTH) return { ok: false, code: 'E_PAYLOAD_TOO_LONG' };
    const json = base64urlDecodeAscii(encoded);
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, code: 'E_PAYLOAD_JSON' };
    }
    const payload = normalizePayload(raw);
    return { ok: true, payload, canonical: canonicalJson(payload) };
  } catch (e) {
    if (e instanceof PayloadError) return { ok: false, code: e.code };
    return { ok: false, code: 'E_PAYLOAD_INVALID' };
  }
}

// ---------------------------------------------------------------- 与排盘输入互转

export function payloadToBirthInput(p: PayloadV1): BirthInput {
  return {
    calendar: p.c === 's' ? 'solar' : 'lunar',
    date: p.d,
    ...(p.c === 'l' ? { isLeapMonth: p.lp === 1 } : {}),
    time: p.t,
    gender: p.g === 'm' ? '男' : '女',
    placeCode: p.p,
    jieqiChoice: p.j,
  };
}

export function birthInputToPayload(b: BirthInput): PayloadV1 {
  return normalizePayload({
    v: 1,
    c: b.calendar === 'solar' ? 's' : 'l',
    d: b.date,
    lp: b.calendar === 'lunar' && b.isLeapMonth ? 1 : 0,
    t: b.time,
    g: b.gender === '男' ? 'm' : 'f',
    p: b.placeCode,
    j: b.jieqiChoice,
  });
}
