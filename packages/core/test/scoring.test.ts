/**
 * T20 大运 / 流年评分（report-sections.md §8 R-YUN-SCORE / R-LN-SCORE）。
 *
 * 验收：阈值边界用例；手算 2 个案例的大运、流年分数一致；评分函数的输入类型里没有吉神字段（类型层面保证）。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { computeChart } from '../src/index';
import {
  analyze,
  computeScores,
  elementScores,
  ganzhiScore,
  liunianRelations,
  tierOf,
  REL_CHONG_DAY,
  REL_CHONG_MONTH,
  REL_HE_DAY,
  TIER_PINGWEN_MIN,
  TIER_SHUNSHI_MIN,
  TIER_WENSHOU_MIN,
  TIER_XIANGHAO_MIN,
  V_JI_FIRST,
  V_JI_OTHER,
  V_XI,
  V_XIAN,
  V_YONG,
  W_BRANCH,
  W_LN_DAYUN,
  W_LN_SELF,
  W_STEM,
  type ScoringInput,
} from '../src/rules';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
function chartOf(id: string) {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`缺少 ${id}`);
  return computeChart(c.input, REF_DATE_MS);
}

describe('report-sections.md §8 参数 ⇔ 代码常量', () => {
  const md = readRulesFile('report-sections.md');
  const sec = md.slice(md.indexOf('## 8. 评分规则'), md.indexOf('## 9.'));

  it('五行分、干支权重', () => {
    const m = /用神 \+(\d)；喜神 \+(\d)；闲神 (\d)；第一忌神 −(\d)；其余忌神 −(\d)/.exec(sec);
    expect(m).not.toBeNull();
    expect([V_YONG, V_XI, V_XIAN, V_JI_FIRST, V_JI_OTHER]).toEqual([
      Number(m?.[1]),
      Number(m?.[2]),
      Number(m?.[3]),
      -Number(m?.[4]),
      -Number(m?.[5]),
    ]);
    const w = /大运分 = ([\d.]+) × v\(天干五行\) \+ ([\d.]+) × Σ/.exec(sec);
    expect([W_STEM, W_BRANCH]).toEqual([Number(w?.[1]), Number(w?.[2])]);
    const s = /self\s+= ([\d.]+) × v\(流年天干五行\) \+ ([\d.]+) × Σ/.exec(sec);
    expect([W_STEM, W_BRANCH]).toEqual([Number(s?.[1]), Number(s?.[2])]);
  });

  it('流年 relation 与 score 权重', () => {
    const r = /冲日支 −([\d.]+)；冲月支 −([\d.]+)；与日支六合 \+([\d.]+)/.exec(sec);
    expect([REL_CHONG_DAY, REL_CHONG_MONTH, REL_HE_DAY]).toEqual([
      -Number(r?.[1]),
      -Number(r?.[2]),
      Number(r?.[3]),
    ]);
    const sc = /score\s+= ([\d.]+) × self \+ ([\d.]+) × 所在大运分/.exec(sec);
    expect([W_LN_SELF, W_LN_DAYUN]).toEqual([Number(sc?.[1]), Number(sc?.[2])]);
  });

  it('tier 阈值表', () => {
    expect(sec).toMatch(/\| ≥ 1\.2 \| 顺势期 \| 好 \|/);
    expect(sec).toMatch(/\| 0\.4 ～ 1\.2 \| 向好 \| 好 \|/);
    expect(sec).toMatch(/\| −0\.4 ～ 0\.4 \| 平稳 \| 平 \|/);
    expect(sec).toMatch(/\| −1\.2 ～ −0\.4 \| 宜稳守 \| 守 \|/);
    expect(sec).toMatch(/\| < −1\.2 \| 宜保守、打基础 \| 守 \|/);
    expect([TIER_SHUNSHI_MIN, TIER_XIANGHAO_MIN, TIER_PINGWEN_MIN, TIER_WENSHOU_MIN]).toEqual([
      1.2, 0.4, -0.4, -1.2,
    ]);
  });
});

describe('tier 阈值边界（左闭右开，Q4）', () => {
  const cases: [number, string, string][] = [
    [1.2, '顺势期', '好'],
    [1.19, '向好', '好'],
    [0.4, '向好', '好'],
    [0.39, '平稳', '平'],
    [0, '平稳', '平'],
    [-0.4, '平稳', '平'],
    [-0.41, '宜稳守', '守'],
    [-1.2, '宜稳守', '守'],
    [-1.21, '宜保守、打基础', '守'],
    [3, '顺势期', '好'],
    [-3, '宜保守、打基础', '守'],
  ];
  for (const [s, tier, group] of cases) {
    it(`${s} → ${tier}（${group}）`, () => expect(tierOf(s)).toEqual({ tier, tier_group: group }));
  }
  it('浮点表示误差不改变档位（0.5 × −0.8 = −0.4）', () => {
    expect(tierOf(0.5 * -0.8)).toEqual({ tier: '平稳', tier_group: '平' });
    expect(tierOf(0.1 + 0.2 + 0.9)).toEqual({ tier: '顺势期', tier_group: '好' });
  });
});

describe('五行分 v(e)', () => {
  it('用 +2、喜 +1、闲 0、第一忌 −2、其余忌 −1', () => {
    expect(elementScores({ yong: '火', xi: ['木'], ji: ['土', '金'], xian: ['水'] })).toEqual({
      木: 1,
      火: 2,
      土: -2,
      金: -1,
      水: 0,
    });
    expect(elementScores({ yong: '土', xi: ['火'], ji: ['金', '水', '木'], xian: [] })).toEqual({
      木: -1,
      火: 1,
      土: 2,
      金: -2,
      水: -1,
    });
  });
});

describe('流年冲合', () => {
  const p = { year: '癸酉', month: '乙丑', day: '乙未', hour: '己卯' } as const;
  it('冲日支 −0.3、冲月支 −0.2、合日支 +0.2；其余冲合只记录（delta 0）', () => {
    expect(liunianRelations('丑', p)).toEqual([
      { type: '冲', a: '流年支', b: '日支', delta: -0.3 },
    ]);
    expect(liunianRelations('未', p)).toEqual([
      { type: '冲', a: '流年支', b: '月支', delta: -0.2 },
    ]);
    expect(liunianRelations('午', p)).toEqual([{ type: '合', a: '流年支', b: '日支', delta: 0.2 }]);
    expect(liunianRelations('酉', p)).toEqual([{ type: '冲', a: '流年支', b: '时支', delta: 0 }]);
    expect(liunianRelations('卯', p)).toEqual([{ type: '冲', a: '流年支', b: '年支', delta: 0 }]);
    expect(liunianRelations('子', p)).toEqual([{ type: '合', a: '流年支', b: '月支', delta: 0 }]);
    expect(liunianRelations('寅', p)).toEqual([]);
  });
  it('可叠加：同时冲日支与冲月支（日支、月支相同）', () => {
    const rel = liunianRelations('午', { year: '甲辰', month: '戊子', day: '丙子', hour: null });
    expect(rel.map((r) => [r.b, r.delta])).toEqual([
      ['月支', -0.2],
      ['日支', -0.3],
    ]);
  });
  it('三柱不看时支', () => {
    expect(liunianRelations('酉', { ...p, hour: null })).toEqual([]);
  });
});

/**
 * 手算案例一：C16（癸酉 乙丑 乙未 己卯；用火、喜木、忌土金、闲水）。v：木 1、火 2、土 −2、金 −1、水 0。
 * 藏干：寅 甲.6 丙.3 戊.1；卯 乙 1；辰 戊.6 乙.3 癸.1；午 丁.7 己.3；未 己.6 丁.3 乙.1；申 庚.6 壬.3 戊.1；
 *       酉 辛 1；戌 戊.6 辛.3 丁.1。
 * 大运：
 *   丙寅 = 0.4×2 + 0.6×(0.6×1 + 0.3×2 + 0.1×−2) = 0.8 + 0.6×1.0 = 1.40 → 顺势期
 *   丁卯 = 0.8 + 0.6×1 = 1.40 → 顺势期
 *   戊辰 = 0.4×−2 + 0.6×(0.6×−2 + 0.3×1 + 0) = −0.8 − 0.54 = −1.34 → 宜保守、打基础（2026–2030 所在大运）
 * 流年（score = 0.5×self + 0.3×(−1.34) + relation；0.3×−1.34 = −0.402）：
 *   2026 丙午 self = 0.8 + 0.6×(0.7×2 + 0.3×−2) = 1.28；午未合日支 +0.2 → 0.64 − 0.402 + 0.2 = 0.438 → 向好
 *   2027 丁未 self = 0.8 + 0.6×(0.6×−2 + 0.3×2 + 0.1×1) = 0.5；丑未冲月支 −0.2 → 0.25 − 0.402 − 0.2 = −0.352 → 平稳
 *   2028 戊申 self = −0.8 + 0.6×(0.6×−1 + 0 + 0.1×−2) = −1.28；无冲合 → −0.64 − 0.402 = −1.042 → 宜稳守
 *   2029 己酉 self = −0.8 + 0.6×(1×−1) = −1.4；卯酉冲时支（只记录） → −0.7 − 0.402 = −1.102 → 宜稳守
 *   2030 庚戌 self = −0.4 + 0.6×(0.6×−2 + 0.3×−1 + 0.1×2) = −1.18；卯戌合时支（只记录） → −0.59 − 0.402 = −0.992 → 宜稳守
 */
describe('手算案例 C16', () => {
  const a = analyze(chartOf('C16'));
  const s = a.scores;
  it('大运分与 tier', () => {
    expect(s).not.toBeNull();
    const d = s?.dayun ?? [];
    expect(d.slice(0, 3).map((x) => x.ganzhi)).toEqual(['丙寅', '丁卯', '戊辰']);
    expect(d[0]?.score).toBeCloseTo(1.4, 10);
    expect(d[1]?.score).toBeCloseTo(1.4, 10);
    expect(d[2]?.score).toBeCloseTo(-1.34, 10);
    expect(d.slice(0, 3).map((x) => x.tier)).toEqual(['顺势期', '顺势期', '宜保守、打基础']);
  });
  it('流年分、冲合与 tier', () => {
    const ln = s?.liunian ?? [];
    expect(ln.map((x) => `${x.year}${x.ganzhi}/${x.dayun}`)).toEqual([
      '2026丙午/戊辰',
      '2027丁未/戊辰',
      '2028戊申/戊辰',
      '2029己酉/戊辰',
      '2030庚戌/戊辰',
    ]);
    const self = [1.28, 0.5, -1.28, -1.4, -1.18];
    const score = [0.438, -0.352, -1.042, -1.102, -0.992];
    ln.forEach((x, i) => {
      expect(x.self).toBeCloseTo(self[i] as number, 10);
      expect(x.dayun_score).toBeCloseTo(-1.34, 10);
      expect(x.score).toBeCloseTo(score[i] as number, 10);
    });
    expect(ln.map((x) => x.relation)).toEqual([0.2, -0.2, 0, 0, 0]);
    expect(ln[3]?.relations).toEqual([{ type: '冲', a: '流年支', b: '时支', delta: 0 }]);
    expect(ln[4]?.relations).toEqual([{ type: '合', a: '流年支', b: '时支', delta: 0 }]);
    expect(ln.map((x) => x.tier)).toEqual(['向好', '平稳', '宜稳守', '宜稳守', '宜稳守']);
  });
});

/**
 * 手算案例二：C01（癸卯 乙丑 戊戌 庚申；用火、喜土、忌金水、闲木）。v：木 0、火 2、土 1、金 −2、水 −1。
 * 2033 年起运，2026–2030 流年尚未起运 → 所在大运分按 0（Q4）。
 * 大运：甲子 = 0.4×0 + 0.6×(1×−1) = −0.6 → 宜稳守
 * 流年（score = 0.5×self + relation）：
 *   2026 丙午 self = 0.8 + 0.6×(0.7×2 + 0.3×1) = 1.82；无冲合 → 0.91 → 向好
 *   2027 丁未 self = 0.8 + 0.6×(0.6×1 + 0.3×2 + 0) = 1.52；丑未冲月支 −0.2 → 0.56 → 向好
 *   2028 戊申 self = 0.4 + 0.6×(0.6×−2 + 0.3×−1 + 0.1×1) = −0.44；无冲合 → −0.22 → 平稳
 *   2029 己酉 self = 0.4 + 0.6×(1×−2) = −0.8；卯酉冲年支（只记录） → −0.40 → 平稳（恰在边界，左闭）
 *   2030 庚戌 self = −0.8 + 0.6×(0.6×1 + 0.3×−2 + 0.1×2) = −0.68；卯戌合年支（只记录） → −0.34 → 平稳
 */
describe('手算案例 C01（流年尚未起运）', () => {
  const s = analyze(chartOf('C01')).scores;
  it('大运首步甲子 −0.6 宜稳守', () => {
    expect(s?.dayun[0]?.ganzhi).toBe('甲子');
    expect(s?.dayun[0]?.score).toBeCloseTo(-0.6, 10);
    expect(s?.dayun[0]?.tier).toBe('宜稳守');
  });
  it('流年分、冲合与 tier（含 −0.4 边界）', () => {
    const ln = s?.liunian ?? [];
    expect(ln.map((x) => x.dayun)).toEqual([null, null, null, null, null]);
    const self = [1.82, 1.52, -0.44, -0.8, -0.68];
    const score = [0.91, 0.56, -0.22, -0.4, -0.34];
    ln.forEach((x, i) => {
      expect(x.dayun_score).toBe(0);
      expect(x.self).toBeCloseTo(self[i] as number, 10);
      expect(x.score).toBeCloseTo(score[i] as number, 10);
    });
    expect(ln[1]?.relations).toEqual([{ type: '冲', a: '流年支', b: '月支', delta: -0.2 }]);
    expect(ln[3]?.relations).toEqual([{ type: '冲', a: '流年支', b: '年支', delta: 0 }]);
    expect(ln.map((x) => x.tier)).toEqual(['向好', '向好', '平稳', '平稳', '平稳']);
  });
});

describe('吉神不参与评分（类型层面 + 运行时）', () => {
  it('ScoringInput 不含吉神字段；Analysis / Shensha 不能作为输入', () => {
    expectTypeOf<ScoringInput>().not.toHaveProperty('shensha');
    expectTypeOf<ScoringInput>().not.toHaveProperty('jishen');
    expectTypeOf<ScoringInput['yongshen']>().not.toHaveProperty('rules_hit');
    expectTypeOf<keyof ScoringInput>().toEqualTypeOf<
      'yongshen' | 'pillars' | 'dayun' | 'liunian'
    >();
  });

  it('全部案例：analyze 的评分与只用喜忌 + 柱 + 大运 + 流年直接计算的结果相同', () => {
    for (const c of cases) {
      const ch = computeChart(c.input, REF_DATE_MS);
      const a = analyze(ch);
      const { yong, xi, ji, xian } = a.yongshen;
      expect(a.scores).toEqual(
        computeScores({
          yongshen: { yong, xi, ji, xian },
          pillars: ch.pillars,
          dayun: ch.dayun,
          liunian: ch.liunian,
        }),
      );
      expect(a.scores?.dayun).toHaveLength(8);
      expect(a.scores?.liunian).toHaveLength(5);
    }
  });

  it('ganzhiScore 与 v 一致（任意干支分数落在 [−2, 2]）', () => {
    const v = elementScores({ yong: '火', xi: ['木'], ji: ['土', '金'], xian: ['水'] });
    expect(ganzhiScore('丙午', v)).toBeCloseTo(0.4 * 2 + 0.6 * (0.7 * 2 + 0.3 * -2), 10);
  });

  it('只给 pillars 时 scores 为 null', () => {
    expect(analyze({ pillars: chartOf('C16').pillars }).scores).toBeNull();
  });
});
