/**
 * T28 ctx 构造（二）：大运 / 流年 / 关系 / 性格 / 领域 / 吉神字段。
 * 验收：3 个案例 ctx 快照；三柱用例 hour 相关字段全为 null；persona 选取顺序有单元测试。
 */
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import {
  buildCtx,
  buildCtxBase,
  ctxProblems,
  natalRelations,
  personaOf,
  roleOf,
} from '../src/report/ctx';
import { loadCases } from './helpers/cases';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const ctxOf = (id: string) => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const chart = computeChart(c.input, REF_DATE_MS);
  return buildCtx(chart, analyze(chart));
};

describe('快照（C16 四柱、C01 未起运、C19 三柱交节）', () => {
  for (const id of ['C16', 'C01', 'C19']) {
    it(id, () => expect(ctxOf(id)).toMatchSnapshot());
  }
});

describe('全部案例', () => {
  it('ctx 通过字段字典校验（不再允许缺字段）', () => {
    for (const c of cases) {
      expect(ctxProblems(ctxOf(c.id) as unknown as Record<string, unknown>), c.id).toEqual([]);
    }
  });

  it('大运 8 步、流年 5 年；item 字段与 Analysis 评分一致', () => {
    for (const c of cases) {
      const chart = computeChart(c.input, REF_DATE_MS);
      const a = analyze(chart);
      const ctx = buildCtx(chart, a);
      expect(ctx.dayun).toHaveLength(8);
      expect(ctx.liunian).toHaveLength(5);
      ctx.dayun.forEach((d, i) => expect(d.score).toBe(a.scores?.dayun[i]?.score));
      ctx.liunian.forEach((l, i) =>
        expect([l.year, l.tier]).toEqual([a.scores?.liunian[i]?.year, a.scores?.liunian[i]?.tier]),
      );
      // phase：最多一个 current、一个 next；past 都在前、far 都在后
      const phases = ctx.dayun.map((d) => d.phase);
      expect(phases.filter((p) => p === 'current').length).toBeLessThanOrEqual(1);
      expect(phases.filter((p) => p === 'next').length).toBeLessThanOrEqual(1);
      const order = { past: 0, current: 1, next: 2, far: 3 };
      expect([...phases].sort((x, y) => order[x] - order[y])).toEqual(phases);
    }
  });

  it('C16（2026 年在戊辰大运）：current = 戊辰、next = 己巳；流年丙午合日支', () => {
    const ctx = ctxOf('C16');
    expect(ctx.dayun.find((d) => d.phase === 'current')?.ganzhi).toBe('戊辰');
    expect(ctx.dayun.find((d) => d.phase === 'next')?.ganzhi).toBe('己巳');
    expect(ctx.dayun.filter((d) => d.phase === 'past').map((d) => d.ganzhi)).toEqual([
      '丙寅',
      '丁卯',
    ]);
    expect(ctx.liunian[0]).toMatchObject({
      year: 2026,
      ganzhi: '丙午',
      stem_ten_god: '伤官',
      stem_god: '食伤',
      stem_role: '用',
      relations: [{ type: '合', a: '流年支', b: '日支' }],
    });
    // 丑未冲（日支冲月支）、卯酉冲（时支冲年支）；§0 示例只示意了前者
    expect(ctx.relations).toEqual([
      { type: '冲', a: '日支', b: '月支' },
      { type: '冲', a: '时支', b: '年支' },
    ]);
    expect(ctx.ten_gods.persona).toEqual(['比肩', '偏财']);
  });

  it('C01（2033 年才起运）：没有 current，第一步为 next，past 为空，past_group 为 null', () => {
    const ctx = ctxOf('C01');
    expect(ctx.dayun.map((d) => d.phase)).toEqual([
      'next',
      'far',
      'far',
      'far',
      'far',
      'far',
      'far',
      'far',
    ]);
    expect(ctx.dayun_summary.past_group).toBeNull();
    expect(ctx.dayun_summary.far_group).not.toBeNull();
    expect(ctx.liunian.every((l) => l.dayun === null)).toBe(true);
  });
});

describe('三柱（C18 / C19）', () => {
  it('hour 相关字段全为 null；关系与 persona 不看时柱', () => {
    for (const id of ['C18', 'C19']) {
      const ctx = ctxOf(id);
      expect(ctx.pillars.hour).toBeNull();
      expect(ctx.ten_gods.hour_stem).toBeNull();
      expect(ctx.ten_gods.hour_branch).toBeNull();
      const all = [
        ...ctx.relations.flatMap((r) => [r.a, r.b]),
        ...ctx.dayun.flatMap((d) => d.relations.map((r) => r.b)),
        ...ctx.liunian.flatMap((l) => l.relations.map((r) => r.b)),
      ];
      expect(all, id).not.toContain('时支');
      expect(JSON.stringify(ctx)).not.toContain('时干');
    }
  });
  it('C19 交节不确定：吉神只取两组共有（jishen_display）', () => {
    expect(ctxOf('C19').shensha).toEqual(['太极贵人']);
    expect(ctxOf('C19').shensha_first).toBe('太极贵人');
  });
});

describe('persona 选取顺序（R-PERSONA）', () => {
  const base = buildCtxBase(
    computeChart(cases.find((c) => c.id === 'C16')?.input as never, REF_DATE_MS),
    analyze(computeChart(cases.find((c) => c.id === 'C16')?.input as never, REF_DATE_MS)),
  );
  const v = (o: Partial<Record<'比劫' | '印' | '食伤' | '财' | '官杀', number>>) => ({
    比劫: 0,
    印: 0,
    食伤: 0,
    财: 0,
    官杀: 0,
    ...o,
  });
  const tg = (o: Partial<typeof base.ten_gods>) => ({
    ...base,
    ten_gods: { ...base.ten_gods, ...o },
  });

  it('①月干十神在前；②最强组优先取透干的那个（月 → 年 → 时，年干正官先于时干七杀）', () => {
    const b = tg({ month_stem: '比肩', year_stem: '正官', hour_stem: '七杀' });
    expect(personaOf(b, v({ 官杀: 5 }))).toEqual(['比肩', '正官']);
  });
  it('透干按 月 → 年 → 时；未透干取地支本气（月 → 日 → 年 → 时）；都没有取偏', () => {
    const noStem = tg({
      month_stem: '比肩',
      year_stem: '偏印',
      hour_stem: '偏印',
      month_branch: '比肩',
      day_branch: '正财',
      year_branch: '偏财',
    });
    expect(personaOf(noStem, v({ 财: 5 }))).toEqual(['比肩', '正财']);
    const none = tg({
      month_stem: '比肩',
      year_stem: '偏印',
      hour_stem: '偏印',
      month_branch: '比肩',
      day_branch: '比肩',
      year_branch: '比肩',
      hour_branch: '比肩',
    });
    expect(personaOf(none, v({ 官杀: 5 }))).toEqual(['比肩', '七杀']);
  });
  it('③去重：最强组选出的与月干相同 → 取下一组', () => {
    const b = tg({ month_stem: '偏财', year_stem: '偏财', hour_stem: '正印' });
    expect(personaOf(b, v({ 财: 5, 印: 3 }))).toEqual(['偏财', '正印']);
  });
  it('三柱：时干、时支为 null 时不参与', () => {
    const b = tg({
      month_stem: '比肩',
      year_stem: '偏印',
      hour_stem: null,
      hour_branch: null,
      month_branch: '比肩',
      day_branch: '比肩',
      year_branch: '比肩',
    });
    expect(personaOf(b, v({ 官杀: 5 }))).toEqual(['比肩', '七杀']);
  });
});

describe('小工具', () => {
  it('roleOf', () => {
    const ys = { yong: '火' as const, xi: ['木' as const], ji: ['土' as const, '金' as const] };
    expect(['火', '木', '土', '金', '水'].map((e) => roleOf(e as never, ys))).toEqual([
      '用',
      '喜',
      '忌',
      '忌',
      '闲',
    ]);
  });
  it('natalRelations：a 为靠后柱；六冲与六合', () => {
    expect(natalRelations({ year: '甲子', month: '丙午', day: '庚子', hour: '丙子' })).toEqual([
      { type: '冲', a: '月支', b: '年支' },
      { type: '冲', a: '日支', b: '月支' },
      { type: '冲', a: '时支', b: '月支' },
    ]);
    expect(natalRelations({ year: '甲子', month: '乙丑', day: '庚寅', hour: null })).toEqual([
      { type: '合', a: '月支', b: '年支' },
    ]);
  });
});
