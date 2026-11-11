/**
 * T27 ctx 构造（一）：基础字段（report-sections.md §0）。
 * 验收：C16 的 ctx 与 §0 示例结构一致（数值以代码为准）；ctx 通过 fields.ts 校验；ctx 中不含出生日期。
 */
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import { ageAt, buildCtxBase, chartKeyOf, ctxProblems } from '../src/report/ctx';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const ctxOf = (id: string) => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const chart = computeChart(c.input, REF_DATE_MS);
  return { c, chart, ctx: buildCtxBase(chart, analyze(chart)) };
};
/** T28 才构造的字段 */
const T28_FIELDS = [
  'ten_gods.persona',
  'career.mode',
  'partner.role',
  'partner.pct',
  'wealth.role',
  'wealth.level',
  'dayun_summary.past_group',
  'dayun_summary.far_group',
  'relations',
  'shensha',
  'shensha_first',
];

const md = readRulesFile('report-sections.md');
const example = JSON.parse(
  /```json\n([\s\S]*?)```/.exec(md.slice(md.indexOf('## 0. 拼装上下文')))?.[1] ?? '{}',
) as Record<string, Record<string, unknown>>;

describe('C16 ⇔ report-sections.md §0 示例', () => {
  const { ctx } = ctxOf('C16');

  it('T27 各分组的键与示例一致（示例多出的 birth_year 不放：ctx 不含出生日期）', () => {
    for (const g of ['profile', 'pillars', 'day', 'month', 'el', 'strength', 'power_pct']) {
      const exp = Object.keys(example[g] ?? {}).filter((k) => k !== 'birth_year');
      expect(Object.keys((ctx as unknown as Record<string, object>)[g] ?? {}).sort(), g).toEqual(
        expect.arrayContaining(exp.sort()),
      );
    }
    const tg = Object.keys(example.ten_gods ?? {}).filter((k) => k !== 'persona');
    expect(Object.keys(ctx.ten_gods).sort()).toEqual(tg.sort());
    for (const k of Object.keys(example.yongshen ?? {})) expect(ctx.yongshen, k).toHaveProperty(k);
    for (const k of Object.keys(example.gods ?? {})) expect(ctx.gods, k).toHaveProperty(k);
  });

  it('示例中的数值与代码一致（C16 是真实案例）', () => {
    expect(ctx.chart_key).toBe(example.chart_key as unknown as string);
    for (const g of ['pillars', 'day', 'month', 'el', 'power_pct'] as const) {
      expect(ctx[g], g).toEqual(example[g]);
    }
    const tg = { ...(example.ten_gods as Record<string, unknown>) };
    delete tg.persona;
    expect(ctx.ten_gods).toEqual(tg);
    expect(ctx.strength).toEqual(example.strength);
    expect(ctx.gods).toMatchObject(example.gods as object);
    expect(ctx.yongshen).toMatchObject(example.yongshen as object);
    const prof = { ...(example.profile as Record<string, unknown>) };
    delete prof.birth_year;
    expect(ctx.profile).toEqual(prof);
  });
});

describe('全部案例', () => {
  it('ctx 通过字段字典校验（T28 字段暂缺）', () => {
    for (const c of cases) {
      const chart = computeChart(c.input, REF_DATE_MS);
      const ctx = buildCtxBase(chart, analyze(chart));
      expect(ctxProblems(ctx as unknown as Record<string, unknown>, T28_FIELDS), c.id).toEqual([]);
    }
  });

  it('ctx 不含出生日期 / 出生年份 / 出生时刻', () => {
    for (const c of cases) {
      const { chart, ctx } = ctxOf(c.id);
      const json = JSON.stringify(ctx);
      expect(json, c.id).not.toContain(chart.solar_date);
      expect(json, c.id).not.toContain('birth');
      if (chart.input_echo.time) expect(json, c.id).not.toContain(chart.input_echo.time);
      expect(Object.values(ctx.profile).includes(Number(chart.solar_date.slice(0, 4))), c.id).toBe(
        false,
      );
    }
  });

  it('百分比取整口径：S_pct + yidang_pct = 100；power / gods 与 total 一致', () => {
    for (const c of cases) {
      const chart = computeChart(c.input, REF_DATE_MS);
      const a = analyze(chart);
      const ctx = buildCtxBase(chart, a);
      expect(ctx.strength.S_pct + ctx.strength.yidang_pct).toBe(100);
      expect(ctx.gods['财_pct']).toBe(Math.round((a.strength.gods['财'] / a.strength.total) * 100));
      expect(ctx.power_pct['木']).toBe(
        Math.round((a.strength.power['木'] / a.strength.total) * 100),
      );
      const sum = Object.values(ctx.power_pct).reduce((s, x) => s + x, 0);
      expect(Math.abs(sum - 100), c.id).toBeLessThanOrEqual(2);
    }
  });

  it('三柱案例：hour 相关字段为 null，chart_key 用 --', () => {
    for (const id of ['C18', 'C19']) {
      const { ctx } = ctxOf(id);
      expect(ctx.pillars.hour).toBeNull();
      expect(ctx.ten_gods.hour_stem).toBeNull();
      expect(ctx.ten_gods.hour_branch).toBeNull();
      expect(ctx.chart_key).toMatch(/--\|[男女]\|0$/);
      expect(ctx.profile.time_known).toBe(false);
    }
    expect(ctxOf('C19').ctx.profile).toMatchObject({
      confidence: '低',
      uncertain_year_month: true,
    });
    expect(ctxOf('C18').ctx.strength).toMatchObject({
      nohour_cong_possible: true,
      nohour_cong_hours: ['巳', '戌'],
    });
  });

  it('paradox / special / swap 等由规则结果直接映射', () => {
    expect(ctxOf('C01').ctx.strength.paradox).toBe('得令却身弱');
    expect(ctxOf('C14').ctx.strength.special).toBe('从财');
    expect(ctxOf('C14').ctx.yongshen.fy_rule).toBe('Y-CONG');
    expect(ctxOf('C12').ctx.yongshen).toMatchObject({ swap: true, swap_from: '火', swap_to: '土' });
    expect(ctxOf('C12').ctx.yongshen.swap_from_god).toBe('印');
  });
});

describe('小工具', () => {
  it('chart_key', () => {
    expect(chartKeyOf({ year: '癸酉', month: '乙丑', day: '乙未', hour: '己卯' }, '女')).toBe(
      '癸酉乙丑乙未己卯|女|1',
    );
    expect(chartKeyOf({ year: '庚午', month: '辛巳', day: '乙酉', hour: null }, '女')).toBe(
      '庚午辛巳乙酉--|女|0',
    );
  });
  it('周岁（北京时间日期）', () => {
    expect(ageAt('1994-01-09', Date.parse('2026-01-08T23:59:59+08:00'))).toBe(31);
    expect(ageAt('1994-01-09', Date.parse('2026-01-09T00:00:00+08:00'))).toBe(32);
    expect(ageAt('2000-02-29', Date.parse('2026-02-28T12:00:00+08:00'))).toBe(25);
  });
  it('ctxProblems：缺字段、越界、字典外字段都报错', () => {
    const { ctx } = ctxOf('C16');
    const bad = JSON.parse(JSON.stringify(ctx)) as Record<string, Record<string, unknown>>;
    (bad.day as Record<string, unknown>).stem = '子';
    (bad.gods as Record<string, unknown>)['财_pct'] = 101;
    bad.profile = { ...bad.profile, birth_year: 1994 };
    delete (bad.yongshen as Record<string, unknown>).tg;
    expect(ctxProblems(bad, T28_FIELDS)).toEqual([
      'day.stem：取值 "子" 不符合 enum',
      'gods.财_pct：取值 101 不符合 int',
      'yongshen.tg：缺失',
      'profile.birth_year：不在字段字典',
    ]);
  });
});
