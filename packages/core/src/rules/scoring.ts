/**
 * 大运 / 流年评分（TASKS T20；rules/report-sections.md §8 R-YUN-SCORE / R-LN-SCORE）。
 *
 * - 五行分 v(e)：用神 +2；喜神 +1；闲神 0；第一忌神 −2；其余忌神 −1。
 * - 大运分 = 0.4 × v(天干五行) + 0.6 × Σ(藏干比例 × v(藏干五行))。
 * - 流年 self 同大运公式；relation：流年支冲日支 −0.3、冲月支 −0.2、与日支六合 +0.2（可叠加；
 *   其余冲合只记录不加分）；score = 0.5 × self + 0.3 × 所在大运分 + relation。
 * - tier（阈值大运、流年相同）：≥ 1.2 顺势期；[0.4, 1.2) 向好；[−0.4, 0.4) 平稳；[−1.2, −0.4) 宜稳守；< −1.2 宜保守、打基础。
 *   区间按「左闭右开」读（表头首行「≥ 1.2」、末行「< −1.2」），见 docs/QUESTIONS.md Q4。
 * - 尚未起运的流年（Chart.liunian[].dayun = null）：所在大运分按 0 计，见 Q4。
 * - 吉神不参与任何评分：输入类型 ScoringInput 只有柱、大运、流年与喜忌集合（类型层面保证，shensha / Analysis 均不可传入）。
 * 分数保留未四舍五入的浮点值；展示取整由 ctx（T28）负责。
 */
import { ganWuXing, HIDDEN_STEMS } from '../bazi/ten-gods';
import type { Gan, GanZhi, Zhi } from '../bazi/ganzhi';
import type { Chart } from '../bazi/types';
import { ruleHit, type RuleHit } from './rule-hit';
import type { WuXing } from './types';
import type { Yongshen } from './yongshen';

// ---------- 参数（report-sections.md §8，scoring.test.ts 比对） ----------
export const V_YONG = 2;
export const V_XI = 1;
export const V_XIAN = 0;
export const V_JI_FIRST = -2;
export const V_JI_OTHER = -1;
/** 天干 / 地支权重 */
export const W_STEM = 0.4;
export const W_BRANCH = 0.6;
/** 流年 score = W_LN_SELF × self + W_LN_DAYUN × 大运分 + relation */
export const W_LN_SELF = 0.5;
export const W_LN_DAYUN = 0.3;
export const REL_CHONG_DAY = -0.3;
export const REL_CHONG_MONTH = -0.2;
export const REL_HE_DAY = 0.2;
/** tier 下界（左闭） */
export const TIER_SHUNSHI_MIN = 1.2;
export const TIER_XIANGHAO_MIN = 0.4;
export const TIER_PINGWEN_MIN = -0.4;
export const TIER_WENSHOU_MIN = -1.2;
/** 只消除二进制表示误差（与 strength-level.ts 同口径） */
const FP_EPS = 1e-9;

export type Tier = '顺势期' | '向好' | '平稳' | '宜稳守' | '宜保守、打基础';
export type TierGroup = '好' | '平' | '守';

/** 六冲 */
export const LIU_CHONG: Readonly<Record<Zhi, Zhi>> = {
  子: '午',
  午: '子',
  丑: '未',
  未: '丑',
  寅: '申',
  申: '寅',
  卯: '酉',
  酉: '卯',
  辰: '戌',
  戌: '辰',
  巳: '亥',
  亥: '巳',
};
/** 六合 */
export const LIU_HE: Readonly<Record<Zhi, Zhi>> = {
  子: '丑',
  丑: '子',
  寅: '亥',
  亥: '寅',
  卯: '戌',
  戌: '卯',
  辰: '酉',
  酉: '辰',
  巳: '申',
  申: '巳',
  午: '未',
  未: '午',
};

/**
 * 评分输入：只含喜忌集合与柱、大运、流年。故意不接受 Analysis / Shensha（R-LN-SCORE「吉神不参与任何评分」）。
 */
export interface ScoringInput {
  yongshen: Pick<Yongshen, 'yong' | 'xi' | 'ji' | 'xian'>;
  pillars: Chart['pillars'];
  dayun: Pick<Chart['dayun'], 'steps'>;
  liunian: readonly Pick<Chart['liunian'][number], 'year' | 'ganzhi' | 'dayun'>[];
}

export type ElementScores = Readonly<Record<WuXing, number>>;

/** v(e) */
export function elementScores(ys: ScoringInput['yongshen']): ElementScores {
  const v: Record<WuXing, number> = { 木: V_XIAN, 火: V_XIAN, 土: V_XIAN, 金: V_XIAN, 水: V_XIAN };
  for (const e of ys.xi) v[e] = V_XI;
  ys.ji.forEach((e, i) => {
    v[e] = i === 0 ? V_JI_FIRST : V_JI_OTHER;
  });
  v[ys.yong] = V_YONG;
  return v;
}

/** 0.4 × v(干) + 0.6 × Σ(藏干比例 × v(藏干)) */
export function ganzhiScore(gz: GanZhi, v: ElementScores): number {
  const stem = v[ganWuXing(gz[0] as Gan)];
  const branch = HIDDEN_STEMS[gz[1] as Zhi].reduce((s, [g, r]) => s + r * v[ganWuXing(g)], 0);
  return W_STEM * stem + W_BRANCH * branch;
}

export function tierOf(score: number): { tier: Tier; tier_group: TierGroup } {
  if (score >= TIER_SHUNSHI_MIN - FP_EPS) return { tier: '顺势期', tier_group: '好' };
  if (score >= TIER_XIANGHAO_MIN - FP_EPS) return { tier: '向好', tier_group: '好' };
  if (score >= TIER_PINGWEN_MIN - FP_EPS) return { tier: '平稳', tier_group: '平' };
  if (score >= TIER_WENSHOU_MIN - FP_EPS) return { tier: '宜稳守', tier_group: '守' };
  return { tier: '宜保守、打基础', tier_group: '守' };
}

export interface DayunScore {
  idx: number;
  ganzhi: GanZhi;
  score: number;
  tier: Tier;
  tier_group: TierGroup;
}

export type PillarBranchPos = '年支' | '月支' | '日支' | '时支';

export interface LiunianRelation {
  type: '冲' | '合';
  a: '流年支';
  b: PillarBranchPos;
  /** 计入 relation 的分值；只记录不加分的为 0 */
  delta: number;
}

export interface LiunianScore {
  year: number;
  ganzhi: GanZhi;
  dayun: GanZhi | null;
  self: number;
  /** 所在大运分（尚未起运为 0） */
  dayun_score: number;
  relation: number;
  relations: LiunianRelation[];
  score: number;
  tier: Tier;
  tier_group: TierGroup;
}

export interface Scores {
  dayun: DayunScore[];
  liunian: LiunianScore[];
  rules_hit: RuleHit[];
}

const BRANCH_POS: readonly [PillarBranchPos, keyof Chart['pillars']][] = [
  ['年支', 'year'],
  ['月支', 'month'],
  ['日支', 'day'],
  ['时支', 'hour'],
];

/** 流年支与原局各支的六冲 / 六合（三柱不看时支）；只有冲日支、冲月支、合日支计分。 */
export function liunianRelations(lnZhi: Zhi, pillars: Chart['pillars']): LiunianRelation[] {
  const out: LiunianRelation[] = [];
  for (const [pos, key] of BRANCH_POS) {
    const gz = pillars[key];
    if (gz === null) continue;
    const z = gz[1] as Zhi;
    if (LIU_CHONG[lnZhi] === z) {
      out.push({
        type: '冲',
        a: '流年支',
        b: pos,
        delta: pos === '日支' ? REL_CHONG_DAY : pos === '月支' ? REL_CHONG_MONTH : 0,
      });
    }
    if (LIU_HE[lnZhi] === z) {
      out.push({ type: '合', a: '流年支', b: pos, delta: pos === '日支' ? REL_HE_DAY : 0 });
    }
  }
  return out;
}

export function computeScores(input: ScoringInput): Scores {
  const v = elementScores(input.yongshen);
  const dayun: DayunScore[] = input.dayun.steps.map((s, idx) => {
    const score = ganzhiScore(s.ganzhi, v);
    return { idx, ganzhi: s.ganzhi, score, ...tierOf(score) };
  });
  const byGz = new Map<GanZhi, number>(dayun.map((d) => [d.ganzhi, d.score]));

  const liunian: LiunianScore[] = input.liunian.map((ln) => {
    const self = ganzhiScore(ln.ganzhi, v);
    // 第 9 步以后的大运（高龄）不在 8 步表中，按干支现算
    const dayun_score = ln.dayun === null ? 0 : (byGz.get(ln.dayun) ?? ganzhiScore(ln.dayun, v));
    const relations = liunianRelations(ln.ganzhi[1] as Zhi, input.pillars);
    const relation = relations.reduce((s, r) => s + r.delta, 0);
    const score = W_LN_SELF * self + W_LN_DAYUN * dayun_score + relation;
    return {
      year: ln.year,
      ganzhi: ln.ganzhi,
      dayun: ln.dayun,
      self,
      dayun_score,
      relation,
      relations,
      score,
      ...tierOf(score),
    };
  });

  return {
    dayun,
    liunian,
    rules_hit: [
      ruleHit('R-YUN-SCORE', '', { tiers: dayun.map((d) => d.tier) }),
      ruleHit('R-LN-SCORE', '', { tiers: liunian.map((l) => l.tier) }),
    ],
  };
}
