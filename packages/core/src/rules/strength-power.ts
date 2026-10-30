/**
 * 五行力量与十神分组（TASKS T15；rules/strength.md §2、§3、§6）。
 *
 * 规则：
 * - S-POWER（§2.2）：天干（年、月、时；日干不计）按位置权重计分，地支按位置权重 × 藏干比例分配到各五行，
 *   再加合局加成，得到 power；按日主五行分组得到 gods（§1.3）；S =（比劫 + 印）/ total（§3）。
 * - S-ROOT（§2.2 ①）：天干五行在全部地支藏干（含余气）里都没有出现 → 该天干权重 × 0.6。
 * - S-COMBO（§2.2 ③）：三会方 +2.0、三合局 +1.5，三支全见才加（位置不限），三会、三合可同时成立。
 * - 得令 / 得地 / 得势（§3）只用于展示和解释，不参与等级判定。
 * - power_display_pct（§6）：power 的日主五行加 1.0 后归一到 100（只给图表用，S 不受影响）。
 *
 * 精度：全部为未四舍五入的浮点数（§4.3：比较一律用浮点；保留位数在展示层处理）。
 * 三柱（hour = null）时只用年、月、日三柱计分（总权重 7.1），合局也只看三个地支。
 */
import { type Gan, type GanZhi, type Zhi } from '../bazi/ganzhi';
import { ganWuXing, HIDDEN_STEMS, type WuXingName } from '../bazi/ten-gods';
import type { Pillars } from '../bazi/types';
import {
  COMBOS,
  DISPLAY_DAY_MASTER_BONUS,
  POSITION_WEIGHTS,
  ROOT_MIN_RATIO,
  ROOTLESS_STEM_FACTOR,
  type ComboDef,
  type PillarPosition,
} from './params';
import { ruleHit, type RuleHit } from './rule-hit';
import type { GodGroup, WuXing } from './types';

export const WUXING_ORDER: readonly WuXing[] = ['木', '火', '土', '金', '水'];

/** 十神分组按「目标五行相对日主五行」的相生序差 d = (目标 − 我) mod 5 排列（strength.md §1.3）。 */
const GROUP_BY_OFFSET: readonly GodGroup[] = ['比劫', '食伤', '财', '官杀', '印'];

export const GOD_GROUP_ORDER: readonly GodGroup[] = ['比劫', '印', '食伤', '财', '官杀'];

/** element 相对日主五行 dayElement 的十神分组。 */
export function godGroupOf(dayElement: WuXing, element: WuXing): GodGroup {
  const d = (WUXING_ORDER.indexOf(element) - WUXING_ORDER.indexOf(dayElement) + 5) % 5;
  return GROUP_BY_OFFSET[d] as GodGroup;
}

/** 日主五行的某一分组对应的五行（如 日主土 的「印」→ 火）。 */
export function elementOfGroup(dayElement: WuXing, group: GodGroup): WuXing {
  const d = GROUP_BY_OFFSET.indexOf(group);
  return WUXING_ORDER[(WUXING_ORDER.indexOf(dayElement) + d) % 5] as WuXing;
}

export interface StemScore {
  pos: Exclude<PillarPosition, 'day'>;
  stem: Gan;
  element: WuXing;
  /** 是否在地支藏干（含余气）中出现同五行（S-ROOT） */
  rooted: boolean;
  /** 实际计入的分数（无根时已 × 0.6） */
  score: number;
}

export interface ComboHit {
  kind: ComboDef['kind'];
  branches: readonly [Zhi, Zhi, Zhi];
  element: WuXing;
  bonus: number;
}

export interface StrengthPower {
  day_master: { stem: Gan; element: WuXing };
  /** 柱数：4 = 四柱，3 = 三柱（无时辰） */
  pillar_count: 3 | 4;
  power: Record<WuXing, number>;
  total: number;
  power_display_pct: Record<WuXing, number>;
  gods: Record<GodGroup, number>;
  /** 同党比例（比劫 + 印）/ total；total 为 0 时不可能（月支权重恒 > 0） */
  S: number;
  de_ling: boolean;
  de_di: boolean;
  de_shi: number;
  stems: StemScore[];
  combos: ComboHit[];
  rules_hit: RuleHit[];
}

const STEM_POSITIONS = ['year', 'month', 'hour'] as const;
const BRANCH_POSITIONS = ['year', 'month', 'day', 'hour'] as const;

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function splitGanZhi(gz: GanZhi): [Gan, Zhi] {
  return [gz[0] as Gan, gz[1] as Zhi];
}

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/**
 * 计算五行力量、十神分组、S、得令 / 得地 / 得势（strength.md §2、§3、§6）。
 * 只依赖四柱（或三柱）干支，同样输入永远同样输出。
 */
export function computeStrengthPower(pillars: Pillars): StrengthPower {
  const [dayStem] = splitGanZhi(pillars.day);
  const dayElement: WuXing = ganWuXing(dayStem);

  const stemsByPos: Partial<Record<PillarPosition, Gan>> = {};
  const branchesByPos: Partial<Record<PillarPosition, Zhi>> = {};
  for (const pos of BRANCH_POSITIONS) {
    const gz = pillars[pos];
    if (gz === null) continue;
    const [g, z] = splitGanZhi(gz);
    stemsByPos[pos] = g;
    branchesByPos[pos] = z;
  }
  const branchList = BRANCH_POSITIONS.flatMap((p) => {
    const z = branchesByPos[p];
    return z === undefined ? [] : [{ pos: p, zhi: z }];
  });

  // 地支藏干中出现过的五行（含余气）—— S-ROOT 的判据
  const hiddenElements = new Set<WuXingName>(
    branchList.flatMap(({ zhi }) => HIDDEN_STEMS[zhi].map(([h]) => ganWuXing(h))),
  );

  const power = zeroRecord(WUXING_ORDER);
  const rulesHit: RuleHit[] = [];

  // ① 天干（年、月、时；日干不计）
  const stems: StemScore[] = [];
  for (const pos of STEM_POSITIONS) {
    const g = stemsByPos[pos];
    if (g === undefined) continue;
    const element = ganWuXing(g);
    const rooted = hiddenElements.has(element);
    const base = POSITION_WEIGHTS.stem[pos];
    const score = rooted ? base : base * ROOTLESS_STEM_FACTOR;
    power[element] += score;
    stems.push({ pos, stem: g, element, rooted, score });
  }

  // ② 地支藏干
  for (const { pos, zhi } of branchList) {
    const w = POSITION_WEIGHTS.branch[pos];
    for (const [h, r] of HIDDEN_STEMS[zhi]) power[ganWuXing(h)] += w * r;
  }

  // ③ 合局加成（三支全见，位置不限）
  const present = new Set(branchList.map((b) => b.zhi));
  const combos: ComboHit[] = COMBOS.filter((c) => c.branches.every((z) => present.has(z))).map(
    (c) => ({ kind: c.kind, branches: c.branches, element: c.element, bonus: c.bonus }),
  );
  for (const c of combos) power[c.element] += c.bonus;

  const total = WUXING_ORDER.reduce((s, e) => s + power[e], 0);

  const gods = zeroRecord(GOD_GROUP_ORDER);
  for (const e of WUXING_ORDER) gods[godGroupOf(dayElement, e)] += power[e];
  const S = (gods['比劫'] + gods['印']) / total;

  // 展示用：日干五行加 1.0 后归一到 100（§6）
  const displayTotal = total + DISPLAY_DAY_MASTER_BONUS;
  const power_display_pct = zeroRecord(WUXING_ORDER);
  for (const e of WUXING_ORDER) {
    const v = power[e] + (e === dayElement ? DISPLAY_DAY_MASTER_BONUS : 0);
    power_display_pct[e] = (v / displayTotal) * 100;
  }

  // 得令 / 得地 / 得势（§3）
  const isSameParty = (g: GodGroup) => g === '比劫' || g === '印';
  const groupOfGan = (g: Gan) => godGroupOf(dayElement, ganWuXing(g));
  const monthBranch = branchesByPos.month as Zhi;
  const monthMain = (HIDDEN_STEMS[monthBranch][0] as readonly [Gan, number])[0];
  const de_ling = isSameParty(groupOfGan(monthMain));
  const de_di = branchList.some(({ zhi }) => {
    const hide = HIDDEN_STEMS[zhi];
    const main = (hide[0] as readonly [Gan, number])[0];
    return (
      hide.some(([h, r]) => r >= ROOT_MIN_RATIO && groupOfGan(h) === '比劫') ||
      groupOfGan(main) === '印'
    );
  });
  const de_shi = stems.filter((s) => isSameParty(godGroupOf(dayElement, s.element))).length;

  // 规则命中记录
  rulesHit.push(
    ruleHit('S-POWER', '', {
      pillar_count: pillars.hour === null ? 3 : 4,
      power: Object.fromEntries(WUXING_ORDER.map((e) => [e, round(power[e], 4)])),
      total: round(total, 4),
      S: round(S, 6),
    }),
  );
  for (const s of stems) {
    if (!s.rooted) {
      rulesHit.push(
        ruleHit('S-ROOT', `${posLabel(s.pos)}${s.stem}无根×${ROOTLESS_STEM_FACTOR}`, {
          pos: s.pos,
          stem: s.stem,
          element: s.element,
          score: round(s.score, 4),
        }),
      );
    }
  }
  for (const c of combos) {
    rulesHit.push(
      ruleHit('S-COMBO', `${c.kind}${c.branches.join('')}${c.element}+${c.bonus.toFixed(1)}`, {
        kind: c.kind,
        branches: [...c.branches],
        element: c.element,
        bonus: c.bonus,
      }),
    );
  }

  return {
    day_master: { stem: dayStem, element: dayElement },
    pillar_count: pillars.hour === null ? 3 : 4,
    power,
    total,
    power_display_pct,
    gods,
    S,
    de_ling,
    de_di,
    de_shi,
    stems,
    combos,
    rules_hit: rulesHit,
  };
}

function posLabel(pos: Exclude<PillarPosition, 'day'>): string {
  return pos === 'year' ? '年干' : pos === 'month' ? '月干' : '时干';
}
