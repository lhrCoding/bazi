/**
 * T36 确定性、性能、润色接口（默认关闭）。
 * 验收（PRD P0-7）：同输入两次报告 JSON 逐字相等；cases.json 全部案例拼装 p95 < 200 ms；
 * 润色关闭时不产生任何外部调用（fetch / http / https 换成抛错桩）。
 */
import http from 'node:http';
import https from 'node:https';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze, computeChart } from '../src/index';
import {
  assembleReport,
  limitationsFromStrengthMd,
  type ParaBlock,
  type Report,
} from '../src/report/assemble';
import { buildCtx } from '../src/report/ctx';
import {
  createPolisher,
  lockedTerms,
  NoopPolisher,
  parsePolishEnabled,
  PolishConfigError,
  polishReport,
  validatePolish,
  type Polisher,
} from '../src/report/polish';
import { createLibrary } from '../src/report/select';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const read = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
    .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') }));
const library = createLibrary(
  parseTextsFiles([
    ...read(fileURLToPath(new URL('../../../rules/texts/', import.meta.url))),
    ...read(fileURLToPath(new URL('./fixtures/texts/', import.meta.url))),
  ]),
  ['draft', 'reviewed', 'approved'],
);
const glossary = glossaryFromReadme(readRulesFile('texts/README.md'));
const limitations = limitationsFromStrengthMd(readRulesFile('strength.md'));

/** 完整流程：排盘 → 规则 → ctx → 拼装 */
function fullReport(input: unknown): Report {
  const chart = computeChart(input as never, REF);
  const analysis = analyze(chart);
  return assembleReport({
    chart,
    analysis,
    ctx: buildCtx(chart, analysis),
    library,
    glossary,
    textsVersion: 'dev',
    limitations,
  });
}
const paras = (r: Report): ParaBlock[] =>
  r.chapters.flatMap((c) =>
    c.blocks.flatMap((b) =>
      b.type === 'para'
        ? [b]
        : b.type === 'yearCard'
          ? [
              ...b.head,
              ...b.domains.career,
              ...b.domains.wealth,
              ...b.domains.love,
              ...b.domains.health,
              ...b.do,
              ...b.watch,
              ...b.rel,
            ]
          : [],
    ),
  );

describe('确定性（P0-7「逐字一致」）', () => {
  it('20 个案例：同输入两次报告 JSON 逐字相等；关闭润色后仍是同一份', async () => {
    for (const c of cases) {
      const a = JSON.stringify(fullReport(c.input));
      expect(JSON.stringify(fullReport(c.input)), c.id).toBe(a);
      const out = await polishReport(JSON.parse(a) as Report, createPolisher({ enabled: false }));
      expect(JSON.stringify(out.report), c.id).toBe(a);
      expect(out.sent).toBe(0);
    }
  });
});

describe('性能', () => {
  it('cases.json 全部案例完整拼装 p95 < 200 ms（每例 5 次，共 100 次）', () => {
    for (const c of cases) fullReport(c.input); // 预热
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (const c of cases) {
        const t = performance.now();
        fullReport(c.input);
        ms.push(performance.now() - t);
      }
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(ms.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(200);
  });
});

describe('润色关闭时零外部调用（P0-7）', () => {
  afterEach(() => vi.restoreAllMocks());
  it('fetch / http.request / https.request 换成抛错桩后，完整流程 + 关闭的润色都不触碰它们', async () => {
    const boom = () => {
      throw new Error('不允许外部调用');
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(boom);
    const httpSpy = vi.spyOn(http, 'request').mockImplementation(boom);
    const httpsSpy = vi.spyOn(https, 'request').mockImplementation(boom);
    const httpGet = vi.spyOn(http, 'get').mockImplementation(boom);
    const httpsGet = vi.spyOn(https, 'get').mockImplementation(boom);
    const polisher = createPolisher({ enabled: parsePolishEnabled(undefined) });
    for (const c of cases) await polishReport(fullReport(c.input), polisher);
    for (const s of [fetchSpy, httpSpy, httpsSpy, httpGet, httpsGet])
      expect(s).not.toHaveBeenCalled();
  });
});

describe('开关与配置', () => {
  it('REPORT_POLISH_ENABLED：未设置 / 空 / false → 关闭；true → 开启；其他值报错', () => {
    expect([undefined, '', 'false', 'FALSE', '0'].map(parsePolishEnabled)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(parsePolishEnabled('true')).toBe(true);
    expect(() => parsePolishEnabled('yes')).toThrow(PolishConfigError);
  });
  it('开启但没有真实实现 → 启动期报错；关闭 → NoopPolisher', () => {
    expect(() => createPolisher({ enabled: true })).toThrow(PolishConfigError);
    expect(() => createPolisher({ enabled: true, impl: NoopPolisher })).toThrow(PolishConfigError);
    expect(createPolisher({ enabled: false })).toBe(NoopPolisher);
  });
});

describe('润色结果校验（§9 第 4 条）', () => {
  const t = '2026年是丙午年，伤官主事，档位向好；火占 41%，是你的用神。';
  it('锁定词：年份、干支、十神、档位、百分比、五行、喜忌角色词', () => {
    expect(lockedTerms(t)).toEqual(['2026年', '丙午', '伤官', '向好', '火', '41%', '用神']);
  });
  it('只调整语序 / 连接词 → 通过；改数字、加五行、删锁定词、字数超 ±15% → 拒绝', () => {
    expect(
      validatePolish(t, '2026年即丙午年，伤官主事、档位向好；火占 41%，它是你的用神。'),
    ).toBeNull();
    expect(validatePolish(t, t.replace('41%', '42%'))).toMatch(/新增了锁定词：42%/);
    expect(validatePolish(t, `${t}也喜木。`)).toMatch(/新增了锁定词：木/);
    expect(validatePolish(t, t.replace('伤官主事，', ''))).toBe('锁定词被删除或次数改变');
    expect(validatePolish(t, `${t}${'很好的一年'.repeat(3)}`)).toMatch(/超过 ±15%/);
  });
});

describe('polishReport（模拟实现）', () => {
  const report = fullReport(cases.find((c) => c.id === 'C16')?.input);
  it('只送允许润色的素材段落：代码模板、结论段、DO / WATCH、健康段、吉神段不送', async () => {
    const seen: string[] = [];
    const spy: Polisher = {
      name: 'spy',
      polish: (s) => (seen.push(s.text), Promise.resolve(s.text)),
    };
    const out = await polishReport(report, spy);
    const sentSlots = new Set(
      paras(report)
        .filter((p) => seen.includes(p.text))
        .map((p) => p.slot),
    );
    for (const s of [
      'CH2-SUMMARY',
      'CH1-CONCLUSION',
      'CH6-DO',
      'CH6-WATCH',
      'CH6-HEALTH',
      'CH3-PERSONA-LINE',
      'CH3-SHENSHA',
    ]) {
      expect(sentSlots.has(s), s).toBe(false);
    }
    expect(sentSlots.has('CH1-DAYMASTER')).toBe(true);
    expect(out.accepted).toBe(out.sent);
  });
  it('合规改写被采用；改事实被拒绝并保留原文；原报告对象不被修改', async () => {
    const before = JSON.stringify(report);
    const swap: Polisher = {
      name: 'swap',
      polish: (s) => Promise.resolve(s.text.replace('。', '；')),
    };
    const ok = await polishReport(report, swap);
    expect(ok.accepted).toBeGreaterThan(0);
    const bad: Polisher = { name: 'bad', polish: (s) => Promise.resolve(`${s.text}2099年`) };
    const no = await polishReport(report, bad);
    expect(no.accepted).toBe(0);
    expect(no.rejected.every((r) => r.reason.startsWith('新增了锁定词'))).toBe(true);
    expect(JSON.stringify(no.report)).toBe(before);
    expect(JSON.stringify(report)).toBe(before);
  });
  it('单段超时、出错、全报告超时 → 用原文，不阻塞', async () => {
    const slow: Polisher = { name: 'slow', polish: () => new Promise(() => undefined) };
    const r1 = await polishReport(report, slow, { segmentMs: 5, reportMs: 40 });
    expect(r1.accepted).toBe(0);
    expect(r1.rejected.some((r) => r.reason === '单段润色超时')).toBe(true);
    expect(r1.rejected.some((r) => r.reason === '全报告润色超时')).toBe(true);
    const err: Polisher = { name: 'err', polish: () => Promise.reject(new Error('网络错误')) };
    const r2 = await polishReport(report, err);
    expect(r2.rejected[0]?.reason).toBe('润色出错：网络错误');
    expect(JSON.stringify(r2.report)).toBe(JSON.stringify(report));
  });
});
