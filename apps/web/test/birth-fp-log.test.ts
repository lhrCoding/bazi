/**
 * T41 指纹 HMAC、日志与错误码。
 * 验收：指纹固定向量测试；Zod 校验失败时日志中不出现输入值（测试捕获日志断言）；改动一个字符载荷指纹不同。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaziError, computeChart } from '@zhiming/core';
import { canonicalJson, decodePayload, encodePayload, type PayloadV1 } from '@zhiming/core/birth';
import {
  birthFp,
  birthFpFromPayload,
  fpEquals,
  FpConfigError,
  loadFpKey,
} from '../server/birth-fp';
import { ApiError, handleApiError, toErrorResponse } from '../server/errors';
import { createLogger, safeEvent, serializeError } from '../server/log';

/** 测试专用密钥（不是生产密钥）：00 01 02 … 1f */
const TEST_KEY = {
  BIRTH_FP_KEY: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  BIRTH_FP_KEY_ID: 'k1',
};
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

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger(stream, 'debug'), lines, text: () => lines.join('') };
}

describe('指纹 HMAC-SHA256', () => {
  const k = loadFpKey(TEST_KEY);
  it('固定向量（openssl dgst -sha256 -mac HMAC 独立计算）', () => {
    expect(birthFp(canonicalJson(SAMPLE), k)).toBe(
      '9f72e81556e7167bfad7ca56b4d73feb83e10582cfee6cf523ca735377ef6fdf',
    );
    expect(birthFp(canonicalJson({ ...SAMPLE, t: '14:31' }), k)).toBe(
      'a27d584c176c8c6d63ff1078fb176ce96c6f72c534d0400eb2a361bc629d3e9f',
    );
  });
  it('载荷改动一个字符 → 指纹不同；同义写法 → 指纹相同', () => {
    const enc = encodePayload(SAMPLE);
    const a = birthFpFromPayload(enc, k);
    const b = birthFpFromPayload(encodePayload({ ...SAMPLE, d: '1994-01-08' }), k);
    expect(a.ok && b.ok && a.fp !== b.fp).toBe(true);
    // 逐个字符改动编码串：要么解析失败，要么指纹不同
    for (let i = 0; i < enc.length; i++) {
      const ch = enc[i] === 'A' ? 'B' : 'A';
      const r = birthFpFromPayload(enc.slice(0, i) + ch + enc.slice(i + 1), k);
      if (r.ok && a.ok) expect(r.fp, `位置 ${i}`).not.toBe(a.fp);
    }
    const reordered = Buffer.from(
      JSON.stringify({ j: null, g: 'f', t: '14:30', p: '110105', d: '1994-01-09', c: 's', v: 1 }),
    ).toString('base64url');
    const c = birthFpFromPayload(reordered, k);
    expect(c.ok && a.ok && c.fp === a.fp).toBe(true);
  });
  it('换密钥 → 指纹不同；结果带 keyId', () => {
    const k2 = loadFpKey({ BIRTH_FP_KEY: 'ff'.repeat(32), BIRTH_FP_KEY_ID: 'k2' });
    const c = canonicalJson(SAMPLE);
    expect(birthFp(c, k2)).not.toBe(birthFp(c, k));
    expect(birthFpFromPayload(encodePayload(SAMPLE), k2)).toMatchObject({ ok: true, keyId: 'k2' });
  });
  it('非法载荷只返回错误码', () => {
    expect(birthFpFromPayload('!!!', k)).toEqual({ ok: false, code: 'E_PAYLOAD_ENCODING' });
  });
  it('fpEquals：常数时间比较；格式不对返回 false', () => {
    const f = birthFp(canonicalJson(SAMPLE), k);
    expect(fpEquals(f, f)).toBe(true);
    expect(fpEquals(f, `${f.slice(0, 63)}0`)).toBe(f.endsWith('0'));
    expect(fpEquals(f, f.slice(0, 62))).toBe(false);
    expect(fpEquals(f, f.toUpperCase())).toBe(false);
  });
  it('密钥配置：缺失 / 非 hex / 过短 / keyId 不合法都报错，错误信息不含密钥', () => {
    expect(() => loadFpKey({})).toThrow(FpConfigError);
    expect(() => loadFpKey({ ...TEST_KEY, BIRTH_FP_KEY: 'zz'.repeat(32) })).toThrow(FpConfigError);
    expect(() => loadFpKey({ ...TEST_KEY, BIRTH_FP_KEY: 'ab'.repeat(16) })).toThrow(/至少 32 字节/);
    expect(() => loadFpKey({ ...TEST_KEY, BIRTH_FP_KEY_ID: 'K 1' })).toThrow(FpConfigError);
    try {
      loadFpKey({ ...TEST_KEY, BIRTH_FP_KEY: 'ab'.repeat(16) });
    } catch (e) {
      expect((e as Error).message).not.toContain('abab');
    }
  });
});

describe('日志不含出生信息', () => {
  const SENTINEL = ['1987-06-15', '13:47', '19870615', '445122'];
  const payload = encodePayload({ ...SAMPLE, d: '1987-06-15', t: '13:47', p: '445122' });
  const canonical = decodePayload(payload);

  it('Zod 校验失败：message 带收到的值，但日志只记字段路径与问题类型', () => {
    const schema = z.strictObject({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().max(4),
    });
    // Zod v4 默认不在 issue 里带输入；这里开启 reportInput 模拟最坏情况（升级或配置变化后带出输入），日志仍不得含输入
    const r = schema.safeParse(
      { date: '1987-06-15 13:47', time: '13:47', extra: '445122' },
      { reportInput: true },
    );
    expect(r.success).toBe(false);
    const zerr = (r as { error: z.ZodError }).error;
    expect(zerr.message).toContain('13:47'); // 证明此时 ZodError 的 message 确实带出了输入
    const { logger, text } = captureLogger();
    const res = handleApiError(zerr, logger, 'api/chart');
    expect(res.status).toBe(400);
    const log = text();
    for (const s of SENTINEL) expect(log).not.toContain(s);
    expect(log).toContain('"code":"E_INVALID_INPUT"');
    expect(log).toContain('"path":"date"');
  });

  it('redact：payload / birth / b / body / canonical / input / chart_key / cookie 键（顶层与一层嵌套）被屏蔽', () => {
    const { logger, text } = captureLogger();
    logger.info(
      {
        payload,
        birth: '1987-06-15',
        b: payload,
        canonical: canonical.ok ? canonical.canonical : '',
      },
      'x',
    );
    logger.info(
      { req: { body: { date: '1987-06-15' }, headers: { cookie: 'openid=445122' } } },
      'y',
    );
    logger.info({ ctx: { chart_key: '丁卯丙午庚子癸未|女|1', input: { time: '13:47' } } }, 'z');
    const log = text();
    for (const s of [...SENTINEL, payload, payload.slice(10, 26), '丁卯丙午'])
      expect(log, s).not.toContain(s);
    expect(log.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('错误对象：只记 name / code / 调用栈位置，不记 message', () => {
    const e = new Error(`解析失败：${payload} 1987-06-15`);
    const s = serializeError(e);
    expect(JSON.stringify(s)).not.toContain('1987');
    expect(JSON.stringify(s)).not.toContain(payload);
    expect(s.name).toBe('Error');
    expect(s.stack?.every((l) => l.startsWith('at '))).toBe(true);
    const { logger, text } = captureLogger();
    logger.error({ err: e }, 'boom');
    expect(text()).not.toContain('1987');
  });

  it('排盘错误（BaziError）只记错误码；safeEvent 只接受标量字段', () => {
    let err: unknown;
    try {
      computeChart(
        {
          calendar: 'solar',
          date: '1987-02-30',
          time: '13:47',
          gender: '女',
          placeCode: null,
          jieqiChoice: null,
        },
        Date.now(),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BaziError);
    const { logger, text } = captureLogger();
    handleApiError(err, logger, 'api/chart');
    safeEvent(logger, 'fallback_used', { slot: 'CH3-BASE', textsVersion: '3' });
    const log = text();
    expect(log).toContain('"code":"E_INVALID_DATETIME"');
    expect(log).toContain('"event":"fallback_used"');
    for (const s of ['1987-02-30', '13:47']) expect(log).not.toContain(s);
  });
});

describe('API 错误响应格式', () => {
  it('各类错误 → 状态码与 {error:{code,message}}，message 为固定中文、不含输入', async () => {
    expect(toErrorResponse(new ApiError('E_ORDER_NOT_FOUND', 404))).toEqual({
      status: 404,
      body: {
        error: { code: 'E_ORDER_NOT_FOUND', message: '未找到这个订单，请检查链接是否完整。' },
      },
    });
    expect(toErrorResponse(new BaziError('E_DST_GAP', '内部说明 1987-06-15'))).toMatchObject({
      status: 400,
      body: { error: { code: 'E_DST_GAP' } },
    });
    expect(
      JSON.stringify(toErrorResponse(new BaziError('E_DST_GAP', '内部说明 1987-06-15'))),
    ).not.toContain('1987');
    expect(toErrorResponse(new TypeError('x 1987-06-15'))).toEqual({
      status: 500,
      body: { error: { code: 'E_INTERNAL', message: '服务暂时出了点问题，请稍后再试。' } },
    });
    const { logger } = captureLogger();
    const res = handleApiError(new ApiError('E_FP_MISMATCH', 403), logger, 'api/report');
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: { code: 'E_FP_MISMATCH', message: expect.any(String) },
    });
  });
});

describe('serializeError 幂等且不放行可疑对象', () => {
  it('已序列化的 SafeError 原样返回；带输入的「伪 SafeError」不被原样放行', () => {
    const safe = serializeError(new TypeError('x'));
    expect(serializeError(safe)).toEqual(safe);
    const fake = { name: 'Error', stack: ['1987-06-15 13:47'] };
    expect(JSON.stringify(serializeError(fake))).not.toContain('1987');
    const fake2 = { name: 'Error', code: '1987-06-15' };
    expect(JSON.stringify(serializeError(fake2))).not.toContain('1987');
  });
});
