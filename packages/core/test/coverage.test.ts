/**
 * T34 静态覆盖率（report-sections.md §5.1 第 1、2 条）。
 * 验收：fixture 素材上缺口清单正确；故意删一条素材后对应组合出现在清单中；强制范围可由 batches.yaml 推导。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { analyze, computeChart } from '../src/index';
import { buildCtx } from '../src/report/ctx';
import { SLOTS } from '../src/report/slots';
import {
  applyCombo,
  COVERAGE_SPECS,
  computeCoverage,
  enforcedChapters,
  enforcedFailures,
  IMPOSSIBLE_COMBOS,
} from '../src/texts/coverage';
import type { TextEntry } from '../src/texts/schema';
import { parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';

const read = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
    .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') }));
const REAL_DIR = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const real = parseTextsFiles(read(REAL_DIR));
const fixture = parseTextsFiles(read(fileURLToPath(new URL('./fixtures/texts/', import.meta.url))));
const chart = computeChart(
  loadCases().cases.find((c) => c.id === 'C16')?.input as never,
  Date.parse('2026-10-30T00:00:00+08:00'),
);
const base = buildCtx(chart, analyze(chart)) as unknown as Record<string, unknown>;
const ALL = ['draft', 'reviewed', 'approved'] as const;
const chOf = (slot: string): number => Number(slot.slice(2, 3));

describe('穷举定义', () => {
  it('每个必需素材槽位都有 COVERAGE_SPECS；当前没有声明不可能组合', () => {
    const need = SLOTS.filter((s) => s.required && s.source === 'material').map((s) => s.id);
    expect(Object.keys(COVERAGE_SPECS).sort()).toEqual(need.sort());
    expect(IMPOSSIBLE_COMBOS).toEqual([]);
  });
  it('组合数与 report-sections.md §3 维度一致', () => {
    const n = (s: string): number => (COVERAGE_SPECS[s] as () => unknown[])().length;
    expect([
      n('CH1-DAYMASTER'),
      n('CH1-MONTH'),
      n('CH1-BALANCE'),
      n('CH1-CONCLUSION'),
      n('CH2-METHOD'),
    ]).toEqual([10, 25, 14, 6, 12]);
    expect([
      n('CH3-GOD'),
      n('CH4-WHY'),
      n('CH5-STEP'),
      n('CH6-HEAD'),
      n('CH6-DO'),
      n('CH7-WEALTH'),
      n('CH7-HEALTH'),
    ]).toEqual([20, 20, 50, 50, 15, 12, 11]);
  });
  it('applyCombo：写入维度与修饰字段默认值，item.* 写入 ctx.item，不改动基准 ctx', () => {
    const c = applyCombo(base, { 'day.stem': '甲', 'item.tier': '向好' }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(c.day?.stem).toBe('甲');
    expect(c.item?.tier).toBe('向好');
    expect(c.profile).toMatchObject({ time_known: true, confidence: '高' });
    expect(c.strength?.borderline).toBe(false);
    expect((base.day as Record<string, unknown>).stem).toBe('乙');
  });
});

describe('第 1 批真实素材（开发期统计 draft）', () => {
  const r = computeCoverage(real, base, ALL);
  it('第 1、2、6 章必需槽位 100% 覆盖、兜底各 1 条', () => {
    for (const s of r.slots.filter((x) => [1, 2, 6].includes(x.chapter)))
      expect(s.covered, s.slot).toBe(s.combos);
    expect(r.gaps.filter((g) => [1, 2, 6].includes(chOf(g.slot)))).toEqual([]);
    expect(r.fallbackProblems.filter((p) => [1, 2, 6].includes(chOf(p)))).toEqual([]);
  });
  it('缺口清单只在尚未写素材的第 3、4、5、7 章，且等于这些槽位的全部组合', () => {
    const chapters = [...new Set(r.gaps.map((g) => chOf(g.slot)))].sort();
    expect(chapters).toEqual([3, 4, 5, 7]);
    const expected = r.slots
      .filter((s) => [3, 4, 5, 7].includes(s.chapter))
      .reduce((n, s) => n + s.combos, 0);
    expect(r.gaps).toHaveLength(expected);
  });
  it('只统计 approved（生产口径）：全部为缺口', () => {
    const a = computeCoverage(real, base, ['approved']);
    expect(a.slots.every((s) => s.covered === 0)).toBe(true);
  });
});

describe('故意删素材 / fixture', () => {
  it('删掉 CH1-DAYMASTER-JIA → 缺口 {day.stem: 甲}；删掉 CH6-HEAD-QISHA-HAO → 缺口 {七杀, 向好}', () => {
    const cut = real.filter((e) => e.id !== 'CH1-DAYMASTER-JIA' && e.id !== 'CH6-HEAD-QISHA-HAO');
    const r = computeCoverage(cut, base, ALL);
    const g = r.gaps.filter((x) => [1, 2, 6].includes(chOf(x.slot)));
    expect(g).toEqual([
      { slot: 'CH1-DAYMASTER', combo: { 'day.stem': '甲' } },
      { slot: 'CH6-HEAD', combo: { 'item.stem_ten_god': '七杀', 'item.tier': '向好' } },
    ]);
  });
  it('fixture 只有兜底：第 3、4 章全部组合都是缺口（兜底不计覆盖），兜底与固定文本无问题', () => {
    const r = computeCoverage(fixture, base, ALL);
    for (const s of r.slots.filter((x) => [3, 4].includes(x.chapter)))
      expect(s.covered, s.slot).toBe(0);
    expect(r.fallbackProblems.filter((p) => [3, 4].includes(chOf(p)))).toEqual([]);
  });
  it('兜底唯一性：同槽位两条兜底报问题', () => {
    const fb = real.find((e) => e.id === 'CH1-DAYMASTER-FALLBACK') as TextEntry;
    const r = computeCoverage([...real, { ...fb, id: 'CH1-DAYMASTER-FALLBACK2' }], base, ALL);
    expect(r.fallbackProblems).toContain('CH1-DAYMASTER：兜底条目 2 条（应为 1 条）');
  });
  it('不可能组合声明：被声明的组合不计入组合数也不算缺口', () => {
    const cut = real.filter((e) => e.id !== 'CH1-DAYMASTER-JIA');
    const r = computeCoverage(cut, base, ALL, [
      { slot: 'CH1-DAYMASTER', combo: { 'day.stem': '甲' }, reason: '测试' },
    ]);
    expect(r.gaps.some((g) => g.slot === 'CH1-DAYMASTER')).toBe(false);
    expect(r.slots.find((s) => s.slot === 'CH1-DAYMASTER')).toMatchObject({
      combos: 9,
      covered: 9,
    });
  });
});

describe('强制范围由 batches.yaml 推导', () => {
  const batches = parse(readFileSync(REAL_DIR + 'batches.yaml', 'utf8')) as {
    batch: string;
    status: string;
    scope: string[];
  }[];
  it('当前 B1 未批准 → 无强制章节、无失败', () => {
    expect(enforcedChapters(batches)).toEqual([]);
    expect(enforcedFailures(computeCoverage(real, base, ALL), [])).toEqual([]);
  });
  it('B1 批准后 → 强制第 1、2、6 章；这些章的缺口即失败，其余章节只报告', () => {
    const approved = batches.map((b) => (b.batch === 'B1' ? { ...b, status: 'approved' } : b));
    const ch = enforcedChapters(approved);
    expect(ch).toEqual([1, 2, 6]);
    expect(enforcedFailures(computeCoverage(real, base, ALL), ch)).toEqual([]);
    const cut = real.filter((e) => e.id !== 'CH2-METHOD-W-SHA');
    expect(enforcedFailures(computeCoverage(cut, base, ALL), ch)).toEqual([
      'CH2-METHOD {"yongshen.fy_rule":"Y-FY-W-SHA","strength.special":null}',
    ]);
  });
});
