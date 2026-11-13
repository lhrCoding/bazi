/**
 * T43 免费排盘 API POST /api/chart。
 * 验收：接口测试通过；返回数据中没有性格画像、吉神、大运年份（字段白名单测试）；本地 p95 < 150 ms。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { computeChart } from '@zhiming/core';
import { birthInputToPayload, encodePayload } from '@zhiming/core/birth';
import { FREE_RESULT_KEYS, type FreeResult } from '@zhiming/core/report';
import { loadCases } from '../../../packages/core/test/helpers/cases';
import { handleChart, MAX_BODY_BYTES } from '../server/chart-api';
import { createLogger } from '../server/log';
import { createRateLimiter } from '../server/rate-limit';

const NOW = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const payloadOf = (id: string): string => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return encodePayload(birthInputToPayload(c.input));
};

function deps(limit = 1000) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return {
    d: {
      limiter: createRateLimiter({ limit, windowMs: 60_000 }),
      logger: createLogger(stream),
      now: () => NOW,
    },
    logs: () => lines.join(''),
  };
}
const post = (body: string, ip = '10.0.0.1') =>
  new Request('http://localhost/api/chart', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body,
  });
async function call(body: unknown, dd = deps().d): Promise<{ status: number; json: unknown }> {
  const res = await handleChart(post(typeof body === 'string' ? body : JSON.stringify(body)), dd);
  return { status: res.status, json: await res.json() };
}

describe('正常返回', () => {
  it('C16：4 个模块；顶层字段与白名单完全一致；句式按 report-sections.md §1', async () => {
    const { status, json } = await call({ payload: payloadOf('C16') });
    expect(status).toBe(200);
    const r = json as FreeResult;
    expect(Object.keys(r).sort()).toEqual([...FREE_RESULT_KEYS].sort());
    expect(r.pillars.ganzhi).toEqual(['癸酉', '乙丑', '乙未', '己卯']);
    expect(r.pillars.stemGods).toEqual(['偏印', '比肩', '日主', '偏财']);
    expect(r.strength.sentence).toBe('乙木生于丑月，失令，帮扶力量占 42%，属中和偏弱。');
    expect(r.yongshen.sentence).toBe('对你有利的五行：火（主）、木；需要节制的五行：土、金。');
    expect(r.power.sentence).toBe('帮扶你的力量占 42%');
    expect(r.power.data.map((x) => x.element)).toEqual(['木', '火', '土', '金', '水']);
    expect(r.power.data.every((x) => Number.isInteger(x.pct))).toBe(true);
    expect(r.pillars.tstNotice).toMatch(/^时辰按北京时间排定/);
    expect(r.nohourNotice).toBeNull();
    expect(r.strength.confidenceNote).toBeNull();
  });

  it('20 个案例：没有性格画像、吉神、大运 / 流年年份（P0-4 字段白名单）', async () => {
    for (const c of cases) {
      const { status, json } = await call({ payload: payloadOf(c.id) });
      expect(status, c.id).toBe(200);
      // 三柱缺失说明是 R-NOHOUR 规定的固定文字（含「流年与时柱的冲合」），不是个人化内容，扫描时排除
      const s = JSON.stringify({ ...(json as object), nohourNotice: null });
      for (const w of [
        '贵人',
        '吉神',
        '性格',
        '画像',
        'persona',
        'shensha',
        'jishen',
        'dayun',
        'liunian',
        '大运',
        '流年',
      ]) {
        expect(s, `${c.id} ${w}`).not.toContain(w);
      }
      const chart = computeChart(c.input, NOW);
      for (const st of chart.dayun.steps)
        expect(s, `${c.id} ${st.startYear}`).not.toContain(String(st.startYear));
      expect(Object.keys(json as object).sort()).toEqual([...FREE_RESULT_KEYS].sort());
    }
  });

  it('三柱交节（C19）：时柱「未知」、置信度灰字（低）、交节提示（用「你」）、缺失说明；无真太阳时灰字', async () => {
    const r = (await call({ payload: payloadOf('C19') })).json as FreeResult;
    expect(r.hourKnown).toBe(false);
    expect(r.pillars.ganzhi[3]).toBe('未知');
    expect(r.pillars.tstNotice).toBeNull();
    expect(r.strength.confidenceNote).toBe('时辰未知，此项仅供参考。');
    expect(r.yongshen.confidenceNote).toBe('时辰未知，此项仅供参考。');
    expect(r.pillars.jieqi).toMatchObject({ name: '立春', side: 'before' });
    expect(r.pillars.jieqi?.prompt).toMatch(/^你出生当天 \d\d:\d\d 交节（立春）/);
    expect(r.nohourNotice).toContain('可信度为「低」');
  });

  it('三柱高置信（C18）：置信度灰字为空', async () => {
    const r = (await call({ payload: payloadOf('C18') })).json as FreeResult;
    expect(r.strength.confidenceNote).toBeNull();
    expect(r.nohourNotice).toContain('可信度为「高」');
  });

  it('选了出生地（C08 乌鲁木齐）：真太阳时说明', async () => {
    const r = (await call({ payload: payloadOf('C08') })).json as FreeResult;
    expect(r.pillars.tstNotice).toMatch(
      /^北京时间 00:40 → 真太阳时 22:19（经度修正 −130 分、均时差 −11 分）$/,
    );
  });
});

describe('错误：只返回错误码，不回显输入', () => {
  const cases2: [string, unknown, number, string][] = [
    ['非 JSON', '1987-06-15 13:47', 400, 'E_BAD_REQUEST'],
    ['多余字段', { payload: payloadOf('C16'), date: '1987-06-15' }, 400, 'E_INVALID_INPUT'],
    ['缺 payload', {}, 400, 'E_INVALID_INPUT'],
    ['坏载荷', { payload: '!!!' }, 400, 'E_PAYLOAD_ENCODING'],
    [
      '不存在的闰月',
      {
        payload: encodePayload({
          v: 1,
          c: 'l',
          d: '2024-01-15',
          lp: 1,
          t: '13:47',
          g: 'm',
          p: null,
          j: null,
        }),
      },
      400,
      'E_LUNAR_NO_LEAP',
    ],
    [
      '未知出生地',
      {
        payload: encodePayload({
          v: 1,
          c: 's',
          d: '1987-06-15',
          lp: 0,
          t: '13:47',
          g: 'm',
          p: '999999',
          j: null,
        }),
      },
      400,
      'E_UNKNOWN_PLACE',
    ],
    ['请求体过大', JSON.stringify({ payload: 'A'.repeat(MAX_BODY_BYTES) }), 413, 'E_BAD_REQUEST'],
  ];
  for (const [name, body, status, code] of cases2) {
    it(`${name} → ${status} ${code}`, async () => {
      const { d, logs } = deps();
      const r = await call(body, d);
      expect(r.status).toBe(status);
      expect((r.json as { error: { code: string } }).error.code).toBe(code);
      expect(JSON.stringify(r.json)).not.toContain('1987');
      expect(logs()).not.toContain('1987');
      expect(logs()).not.toContain('13:47');
    });
  }
  it('限流：同一 IP 超过上限 → 429；换 IP 不受影响', async () => {
    const { d } = deps(3);
    const body = { payload: payloadOf('C16') };
    for (let i = 0; i < 3; i++) expect((await call(body, d)).status).toBe(200);
    expect((await call(body, d)).status).toBe(429);
    const other = await handleChart(post(JSON.stringify(body), '10.0.0.2'), d);
    expect(other.status).toBe(200);
  });
});

describe('性能与日志', () => {
  it('本地 p95 < 150 ms（20 个案例各 3 次）', async () => {
    const { d } = deps();
    const ms: number[] = [];
    for (let i = 0; i < 3; i++) {
      for (const c of cases) {
        const t = performance.now();
        await call({ payload: payloadOf(c.id) }, d);
        ms.push(performance.now() - t);
      }
    }
    ms.sort((a, b) => a - b);
    expect(ms[Math.ceil(ms.length * 0.95) - 1]).toBeLessThan(150);
  });
  it('成功请求不写日志；响应 no-store', async () => {
    const { d, logs } = deps();
    const res = await handleChart(post(JSON.stringify({ payload: payloadOf('C16') })), d);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logs()).toBe('');
  });
});
