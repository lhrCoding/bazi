/**
 * 旺衰等级与特殊格局（TASKS T16；rules/strength.md §4、§5 第 1 条）。
 *
 * 判定顺序（§4，严格按顺序，命中即停）：
 *   ① 有时柱 且 S < 0.20 且 满足从弱条件（S-CONG，5 条全满足，只认真从）→ 从弱，special = 从财 / 从杀 / 从儿 / 从势
 *   ② 有时柱 且 S ≥ 0.80 且 满足专旺 / 从强条件（S-ZHUANWANG）        → 从强，special = 专旺 / 从强
 *   ③ S ≥ 0.50 身旺；④ 0.45 ≤ S < 0.50 中和偏旺；⑤ 0.40 ≤ S < 0.45 中和偏弱；⑥ 否则身弱
 *
 * - 三柱（hour = null）不判特殊格局（§4.1 条件 5、§4.2 条件 5、§5 第 1 条）：只走 ③–⑥，
 *   S 极端时标「极弱 / 极旺」（extreme 字段），notes 写明「时辰未知，未判断特殊格局」。
 * - borderline（§4.3）：S 与等级阈值 0.50 / 0.45 / 0.40 任一相差 < 0.01（0.20 / 0.80 的口径待裁定，见 docs/QUESTIONS.md）。
 * - 一律用未四舍五入的浮点比较（§4.3）。
 */
import type { Gan, Zhi } from '../bazi/ganzhi';
import { ganWuXing, HIDDEN_STEMS } from '../bazi/ten-gods';
import type { Pillars } from '../bazi/types';
import {
  BORDERLINE_DELTA,
  CONG_DOMINANT_SHARE,
  CONG_MAX_S,
  LEVEL_THRESHOLDS,
  ROOT_MIN_RATIO,
  ZHUANWANG_MAX_CAI_SHARE,
  ZHUANWANG_MAX_GUANSHA_SHARE,
  ZHUANWANG_MIN_S,
} from './params';
import { ruleHit, type RuleEvidence, type RuleHit } from './rule-hit';
import { computeStrengthPower, godGroupOf, type StrengthPower } from './strength-power';
import type {
  CongSpecial,
  GodGroup,
  SpecialPattern,
  StrengthDirection,
  StrengthLevel,
  WuXing,
  ZhuanwangSpecial,
} from './types';


/** 专旺时的「一行得气」名称（§4.2，报告可用）。 */
export const ZHUANWANG_NAMES: Readonly<Record<WuXing, string>> = {
  木: '曲直',
  火: '炎上',
  土: '稼穑',
  金: '从革',
  水: '润下',
};

export const NOTE_NOHOUR_NO_SPECIAL = '时辰未知，未判断特殊格局';

/** 从弱条件逐条检查结果（§4.1）。 */
export interface CongCheck {
  /** 1. S < 0.20 */
  s_below: boolean;
  /** 2. 日主在地支里没有本气 / 中气的根（比劫，比例 ≥ 0.3） */
  no_root: boolean;
  /** 3. 地支里没有本气 / 中气的印 */
  no_yin_root: boolean;
  /** 4. 年、月、时三干没有比劫、印（de_shi == 0） */
  no_stem_support: boolean;
  /** 5. 有时柱 */
  has_hour: boolean;
  satisfied: boolean;
}

/** 专旺 / 从强条件逐条检查结果（§4.2）。 */
export interface ZhuanwangCheck {
  /** 1. S ≥ 0.80 */
  s_above: boolean;
  /** 2. 得令 */
  de_ling: boolean;
  /** 3. 官杀力量 < total × 5%，且三干无官杀透出 */
  guansha_weak: boolean;
  /** 4. 财力量 < total × 10% */
  cai_weak: boolean;
  /** 5. 有时柱 */
  has_hour: boolean;
  satisfied: boolean;
}

export interface StrengthLevelResult {
  level: StrengthLevel;
  special: SpecialPattern | null;
  direction: StrengthDirection;
  borderline: boolean;
  /** 三柱时 S 极端的标注（§5 第 1 条「身弱（极弱）」「身旺（极旺）」）；四柱恒为 null */
  extreme: '极弱' | '极旺' | null;
  cong: CongCheck;
  zhuanwang: ZhuanwangCheck;
  notes: string[];
  rules_hit: RuleHit[];
}

/** 完整旺衰结果 = 计分（T15）+ 等级（T16）；rules_hit 按 S-POWER → S-ROOT → S-COMBO → S-CONG / S-ZHUANWANG → S-LEVEL 排列。 */
export type Strength = Omit<StrengthPower, 'rules_hit'> &
  Omit<StrengthLevelResult, 'rules_hit'> & { rules_hit: RuleHit[] };

const ALIEN_GROUPS_BY_PRIORITY: readonly GodGroup[] = ['财', '官杀', '食伤'];
const CONG_SPECIAL_OF: Readonly<Partial<Record<GodGroup, CongSpecial>>> = {
  财: '从财',
  官杀: '从杀',
  食伤: '从儿',
};

/**
 * 浮点表示误差余量（1e-9，远小于任何有意义的差值）。参数全是一位小数，S、power 在数学上是有限小数，
 * 但二进制浮点求和会带来 1e-16 量级误差：如 甲子 丙寅 乙未 己卯 的 S 数学上恰为 4.55 / 9.1 = 0.5（身旺），
 * 浮点却得到 0.4999…（会误判中和偏旺）。所有阈值比较都经过下面三个函数，按数学值判定 ≥ / < / >。
 * 不做四舍五入（§4.3「比较一律用未四舍五入的浮点数」），只消除表示误差。
 */
const FP_EPS = 1e-9;
const gte = (a: number, b: number): boolean => a >= b - FP_EPS;
const lt = (a: number, b: number): boolean => !gte(a, b);
const gt = (a: number, b: number): boolean => a > b + FP_EPS;

export function levelDirection(level: StrengthLevel): StrengthDirection {
  return level === '身旺' || level === '中和偏旺' || level === '从强' ? '偏旺' : '偏弱';
}

/** §4 ③–⑥ 普通等级。 */
export function ordinaryLevel(S: number): StrengthLevel {
  if (gte(S, LEVEL_THRESHOLDS.strong)) return '身旺';
  if (gte(S, LEVEL_THRESHOLDS.neutralStrong)) return '中和偏旺';
  if (gte(S, LEVEL_THRESHOLDS.neutralWeak)) return '中和偏弱';
  return '身弱';
}


/** §4.3：S 与等级阈值 0.50 / 0.45 / 0.40 任一相差 < 0.01。 */
export function isBorderline(S: number): boolean {
  return Object.values(LEVEL_THRESHOLDS).some(
    (t) => Math.abs(S - t) < BORDERLINE_DELTA - FP_EPS,
  );
}

function branchesOf(pillars: Pillars): Zhi[] {
  return [pillars.year, pillars.month, pillars.day, pillars.hour].flatMap((gz) =>
    gz === null ? [] : [gz[1] as Zhi],
  );
}

/** 地支本气 / 中气（比例 ≥ 0.3）中是否有属于 group 的藏干。 */
function hasRootOf(pillars: Pillars, dayElement: WuXing, group: GodGroup): boolean {
  return branchesOf(pillars).some((z) =>
    HIDDEN_STEMS[z].some(
      ([h, r]) => r >= ROOT_MIN_RATIO && godGroupOf(dayElement, ganWuXing(h as Gan)) === group,
    ),
  );
}

export function checkCong(sp: StrengthPower, pillars: Pillars): CongCheck {
  const dm = sp.day_master.element;
  const c = {
    s_below: lt(sp.S, CONG_MAX_S),
    no_root: !hasRootOf(pillars, dm, '比劫'),
    no_yin_root: !hasRootOf(pillars, dm, '印'),
    no_stem_support: sp.de_shi === 0,
    has_hour: pillars.hour !== null,
  };
  return { ...c, satisfied: Object.values(c).every(Boolean) };
}

/** §4.1 子类型：异党三方最大者 X（并列按 财 > 官杀 > 食伤），X ≥ 异党总和 50% → 对应从格，否则从势。 */
export function congSpecialOf(gods: Readonly<Record<GodGroup, number>>): CongSpecial {
  let top: GodGroup = ALIEN_GROUPS_BY_PRIORITY[0] as GodGroup;
  for (const g of ALIEN_GROUPS_BY_PRIORITY) if (gt(gods[g], gods[top])) top = g;
  const alienTotal = ALIEN_GROUPS_BY_PRIORITY.reduce((s, g) => s + gods[g], 0);
  return gte(gods[top], alienTotal * CONG_DOMINANT_SHARE)
    ? (CONG_SPECIAL_OF[top] as CongSpecial)
    : '从势';
}

export function checkZhuanwang(sp: StrengthPower, pillars: Pillars): ZhuanwangCheck {
  const dm = sp.day_master.element;
  const guanshaStem = sp.stems.some((s) => godGroupOf(dm, s.element) === '官杀');
  const c = {
    s_above: gte(sp.S, ZHUANWANG_MIN_S),
    de_ling: sp.de_ling,
    guansha_weak: lt(sp.gods['官杀'], sp.total * ZHUANWANG_MAX_GUANSHA_SHARE) && !guanshaStem,
    cai_weak: lt(sp.gods['财'], sp.total * ZHUANWANG_MAX_CAI_SHARE),
    has_hour: pillars.hour !== null,
  };
  return { ...c, satisfied: Object.values(c).every(Boolean) };
}

/** §4.2 子类型：比劫 ≥ 印 → 专旺，否则从强。 */
export function zhuanwangSpecialOf(gods: Readonly<Record<GodGroup, number>>): ZhuanwangSpecial {
  return gte(gods['比劫'], gods['印']) ? '专旺' : '从强';
}

const ORDINARY_STEP: Readonly<Record<StrengthLevel, string>> = {
  身旺: '③',
  中和偏旺: '④',
  中和偏弱: '⑤',
  身弱: '⑥',
  从弱: '①',
  从强: '②',
};

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/**
 * 由计分结果与四柱（或三柱）判定旺衰等级与特殊格局（strength.md §4）。
 */
export function computeStrengthLevel(sp: StrengthPower, pillars: Pillars): StrengthLevelResult {
  const cong = checkCong(sp, pillars);
  const zhuanwang = checkZhuanwang(sp, pillars);
  const hasHour = pillars.hour !== null;
  const rulesHit: RuleHit[] = [];
  const notes: string[] = [];

  let level: StrengthLevel;
  let special: SpecialPattern | null = null;
  let step: string;

  if (cong.satisfied) {
    // ①
    const sub = congSpecialOf(sp.gods);
    level = '从弱';
    special = sub;
    step = '①';
    rulesHit.push(
      ruleHit('S-CONG', sub, {
        S: r4(sp.S),
        alien: { 食伤: r4(sp.gods['食伤']), 财: r4(sp.gods['财']), 官杀: r4(sp.gods['官杀']) },
        dominant_share: CONG_DOMINANT_SHARE,
      }),
    );
  } else if (zhuanwang.satisfied) {
    // ②
    const sub = zhuanwangSpecialOf(sp.gods);
    level = '从强';
    special = sub;
    step = '②';
    const ev: RuleEvidence = {
      S: r4(sp.S),
      比劫: r4(sp.gods['比劫']),
      印: r4(sp.gods['印']),
      官杀: r4(sp.gods['官杀']),
      财: r4(sp.gods['财']),
      total: r4(sp.total),
      ...(sub === '专旺' ? { name: ZHUANWANG_NAMES[sp.day_master.element] } : {}),
    };
    rulesHit.push(ruleHit('S-ZHUANWANG', sub, ev));
  } else {
    level = ordinaryLevel(sp.S);
    step = ORDINARY_STEP[level];
  }

  let extreme: StrengthLevelResult['extreme'] = null;
  if (!hasHour) {
    notes.push(NOTE_NOHOUR_NO_SPECIAL);
    if (lt(sp.S, CONG_MAX_S)) extreme = '极弱';
    else if (gte(sp.S, ZHUANWANG_MIN_S)) extreme = '极旺';
  }

  const borderline = isBorderline(sp.S);
  rulesHit.push(
    ruleHit('S-LEVEL', level, {
      step,
      S: r4(sp.S),
      thresholds: [
        LEVEL_THRESHOLDS.strong,
        LEVEL_THRESHOLDS.neutralStrong,
        LEVEL_THRESHOLDS.neutralWeak,
      ],
      borderline,
      has_hour: hasHour,
      cong: { ...cong },
      zhuanwang: { ...zhuanwang },
    }),
  );

  return {
    level,
    special,
    direction: levelDirection(level),
    borderline,
    extreme,
    cong,
    zhuanwang,
    notes,
    rules_hit: rulesHit,
  };
}

/** 计分 + 等级一次完成（strength.md §2–§4）。 */
export function computeStrength(pillars: Pillars): Strength {
  const sp = computeStrengthPower(pillars);
  const lv = computeStrengthLevel(sp, pillars);
  return { ...sp, ...lv, rules_hit: [...sp.rules_hit, ...lv.rules_hit] };
}
