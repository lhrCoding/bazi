/**
 * T39 出生信息载荷编解码（ARCHITECTURE §4.4）。
 * 验收：往返测试（属性测试 1,000 次）；同义不同写法 canonical 相同；非法载荷返回错误码且错误对象中不含输入片段。
 */
// 独立参照实现：Node 的 Base64url（测试文件可用 node: 模块，core 源码不用）
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  base64urlDecodeAscii,
  base64urlEncodeAscii,
  birthInputToPayload,
  canonicalJson,
  decodePayload,
  encodePayload,
  MAX_ENCODED_LENGTH,
  normalizePayload,
  payloadToBirthInput,
  PayloadError,
  type PayloadV1,
} from '../src/birth';
import { computeChart } from '../src/index';
import { loadCases } from './helpers/cases';

const SAMPLE: PayloadV1 = {
  v: 1,
  c: 's',
  d: '1994-01-09',
  lp: 0,
  t: '14:30',
  g: 'f',
  p: '110105',
  j: null,
};
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number): string => String(n).padStart(2, '0');

describe('格式与编码', () => {
  it('ARCHITECTURE §4.4 示例：规范串逐字一致、约 100 字符、与 Node Base64url 一致', () => {
    const json = canonicalJson(SAMPLE);
    expect(json).toBe(
      '{"v":1,"c":"s","d":"1994-01-09","lp":0,"t":"14:30","g":"f","p":"110105","j":null}',
    );
    const enc = encodePayload(SAMPLE);
    expect(enc).toBe(b64(json));
    expect(enc.length).toBeLessThan(MAX_ENCODED_LENGTH);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('Base64url 与 Node 实现逐一相同（长度 0–60 的随机 ASCII），解码可逆', () => {
    const r = rng(7);
    for (let n = 0; n <= 60; n++) {
      const s = Array.from({ length: n }, () =>
        String.fromCharCode(32 + Math.floor(r() * 95)),
      ).join('');
      expect(base64urlEncodeAscii(s)).toBe(b64(s));
      expect(base64urlDecodeAscii(b64(s))).toBe(s);
    }
  });
});

describe('往返（属性测试 1,000 次）', () => {
  it('随机合法载荷：encode → decode 得到同一规范载荷；转排盘输入再转回不变', () => {
    const r = rng(20261112);
    const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)] as T;
    for (let i = 0; i < 1000; i++) {
      const c = pick(['s', 'l'] as const);
      const t = r() < 0.15 ? null : `${pad(Math.floor(r() * 24))}:${pad(Math.floor(r() * 60))}`;
      const p: PayloadV1 = {
        v: 1,
        c,
        d: `${1900 + Math.floor(r() * 201)}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`,
        lp: c === 'l' && r() < 0.2 ? 1 : 0,
        t,
        g: pick(['m', 'f'] as const),
        p: r() < 0.5 ? null : String(100000 + Math.floor(r() * 900000)),
        j: t === null ? pick([null, 'before', 'after', 'unsure'] as const) : null,
      };
      const d = decodePayload(encodePayload(p));
      expect(d.ok, JSON.stringify(p)).toBe(true);
      if (!d.ok) continue;
      expect(d.payload).toEqual(p);
      expect(d.canonical).toBe(canonicalJson(p));
      expect(birthInputToPayload(payloadToBirthInput(p))).toEqual(p);
    }
  });
  it('cases.json 全部案例：输入 → 载荷 → 输入 后排盘结果相同', () => {
    for (const c of loadCases().cases) {
      const p = birthInputToPayload(c.input);
      const back = payloadToBirthInput(p);
      const ref = Date.parse('2026-10-30T00:00:00+08:00');
      expect(computeChart(back, ref).pillars, c.id).toEqual(computeChart(c.input, ref).pillars);
    }
  });
});

describe('同义不同写法 → 同一规范串', () => {
  const canon = canonicalJson(SAMPLE);
  const variants: Record<string, unknown>[] = [
    { j: null, p: '110105', g: 'f', t: '14:30', lp: 0, d: '1994-01-09', c: 's', v: 1 }, // 键顺序
    { v: 1, c: 's', d: '1994-01-09', t: '14:30', g: 'f', p: '110105' }, // lp / j 缺省
    { v: 1, c: 's', d: '1994-01-09', lp: false, t: '14:30', g: 'f', p: '110105', j: null }, // lp 布尔
    { v: 1, c: 's', d: '1994-01-09', lp: 0, t: '14:30', g: 'f', p: '110105', j: 'after' }, // 有时辰时 j 不起作用
  ];
  for (const [i, v] of variants.entries()) {
    it(`写法 ${i + 1}`, () => {
      const d = decodePayload(b64(JSON.stringify(v, null, i === 0 ? 2 : 0)));
      expect(d.ok && d.canonical).toBe(canon);
    });
  }
  it('时间 9:05 → 09:05；p 缺省 → null', () => {
    const d = decodePayload(
      b64(JSON.stringify({ v: 1, c: 's', d: '1994-01-09', t: '9:05', g: 'm' })),
    );
    expect(d.ok && d.payload).toMatchObject({ t: '09:05', p: null, lp: 0, j: null });
  });
});

describe('非法载荷：只返回错误码，不含输入片段', () => {
  const bad: [string, string, string][] = [
    ['空串', '', 'E_PAYLOAD_ENCODING'],
    ['超长', 'A'.repeat(MAX_ENCODED_LENGTH + 1), 'E_PAYLOAD_TOO_LONG'],
    ['非法字符', 'eyJ2Ij+x', 'E_PAYLOAD_ENCODING'],
    ['长度余 1', 'abcde', 'E_PAYLOAD_ENCODING'],
    ['非 ASCII', b64('{"d":"一九九四"}'), 'E_PAYLOAD_ENCODING'],
    ['不是 JSON', b64('1994-01-09 14:30 F'), 'E_PAYLOAD_JSON'],
    ['版本', b64(JSON.stringify({ ...SAMPLE, v: 2 })), 'E_PAYLOAD_VERSION'],
    ['多余字段', b64(JSON.stringify({ ...SAMPLE, name: 'zhangsan' })), 'E_PAYLOAD_INVALID'],
    ['日期', b64(JSON.stringify({ ...SAMPLE, d: '1994-13-09' })), 'E_PAYLOAD_INVALID'],
    ['时间', b64(JSON.stringify({ ...SAMPLE, t: '24:00' })), 'E_PAYLOAD_INVALID'],
    ['缺 t', b64(JSON.stringify({ v: 1, c: 's', d: '1994-01-09', g: 'f' })), 'E_PAYLOAD_INVALID'],
    ['公历闰月', b64(JSON.stringify({ ...SAMPLE, lp: 1 })), 'E_PAYLOAD_INVALID'],
    ['性别', b64(JSON.stringify({ ...SAMPLE, g: 'female' })), 'E_PAYLOAD_INVALID'],
    ['出生地', b64(JSON.stringify({ ...SAMPLE, p: '../etc' })), 'E_PAYLOAD_INVALID'],
    ['交节选择', b64(JSON.stringify({ ...SAMPLE, t: null, j: 'maybe' })), 'E_PAYLOAD_INVALID'],
    ['数组', b64('[1,"s"]'), 'E_PAYLOAD_INVALID'],
    ['尾部位不为 0（非规范编码）', 'eyJ', 'E_PAYLOAD_ENCODING'],
  ];
  for (const [name, input, code] of bad) {
    it(`${name} → ${code}`, () => {
      const d = decodePayload(input);
      expect(d).toEqual({ ok: false, code });
      // 结果与错误对象里都不出现输入片段
      const json = JSON.stringify(d);
      for (const frag of ['1994', '14:30', '110105', 'zhangsan', 'female', '../etc'])
        expect(json).not.toContain(frag);
    });
  }
  it('PayloadError 的 message / 字段只有固定说明与错误码', () => {
    try {
      normalizePayload({ ...SAMPLE, d: '1994-13-09' });
    } catch (e) {
      expect(e).toBeInstanceOf(PayloadError);
      const all = JSON.stringify({
        ...(e as object),
        message: (e as Error).message,
        stack: (e as Error).stack,
      });
      expect(all).not.toContain('1994');
      expect((e as PayloadError).code).toBe('E_PAYLOAD_INVALID');
    }
    expect(decodePayload(42)).toEqual({ ok: false, code: 'E_PAYLOAD_ENCODING' });
  });
});
