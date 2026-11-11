/**
 * 三柱时辰扫描与置信度（TASKS T18；rules/strength.md §5 S-NOHOUR，calendar.md §7 CAL-NOHOUR）。
 *
 * - 13 个时柱：早子（按当日日干五鼠遁）、丑……亥（按当日日干）、晚子（按次日日干）。
 * - 每个时柱补到三柱上，按四柱规则各算一次旺衰 + 喜用神（允许判从格），与三柱结论比对：
 *   direction_agree（偏弱 / 偏旺组一致）、yong_agree（用神五行一致）。
 * - 置信度按比例（§5 第 3 条）：高 = 方向 ≥ 0.80 且 用神 ≥ 0.75；中 = 方向 ≥ 0.65；其余低。
 * - 从格提示（§5 第 4 条）：nohour_cong_possible / nohour_cong_hours（时支，按 子…亥，早晚子合并为一个「子」）。
 *   只提示，不改变三柱的旺衰与喜忌。
 * - 交节日降级（§5 第 5 条）：Chart.uncertain.month_pillar 非空时，用另一组年月柱再算一次三柱结论；
 *   方向或用神不同 → 置信度直接「低」，两种结论都写进 notes。
 * - 扫描年月柱一律用 Chart.pillars（即三柱默认的当天 12:00 一侧）。
 * 纯函数：同样的 Chart 永远得到同样的结果。
 */
import { ganZhiIndex, ganZhiOf, type GanZhi, type Zhi } from '../bazi/ganzhi';
import type { Chart } from '../bazi/types';
import { ruleHit, type RuleHit } from './rule-hit';
import { computeStrength, type Strength } from './strength-level';
import type { StrengthDirection, StrengthLevel, WuXing } from './types';
import { computeYongshen, type Yongshen } from './yongshen';

// ---------- 参数（strength.md §5，rules-params.test.ts 比对） ----------
/** 扫描时柱个数：早子 + 丑…亥 + 晚子 */
export const NOHOUR_SCAN_SLOTS = 13;
/** 置信「高」：方向一致比例下限 */
export const CONF_HIGH_DIRECTION_MIN = 0.8;
/** 置信「高」：用神一致比例下限 */
export const CONF_HIGH_YONG_MIN = 0.75;
/** 置信「中」：方向一致比例下限 */
export const CONF_MID_DIRECTION_MIN = 0.65;
/** 只消除二进制表示误差（与 strength-level.ts 同口径） */
const FP_EPS = 1e-9;

export type Confidence = '高' | '中' | '低';

const ZHI_ORDER: readonly Zhi[] = [
  '子',
  '丑',
  '寅',
  '卯',
  '辰',
  '巳',
  '午',
  '未',
  '申',
  '酉',
  '戌',
  '亥',
];

/** 单个扫描时柱的四柱结论 */
export interface NoHourSlot {
  /** 'early-zi' | 'late-zi' | 地支（丑…亥） */
  slot: string;
  hour: GanZhi;
  S: number;
  level: StrengthLevel;
  direction: StrengthDirection;
  special: Strength['special'];
  yong: WuXing;
}

/** 交节日另一组年月柱的三柱结论 */
export interface NoHourAlt {
  pillars: [GanZhi, GanZhi, GanZhi];
  S: number;
  level: StrengthLevel;
  direction: StrengthDirection;
  yong: WuXing;
  xi: WuXing[];
  ji: WuXing[];
  /** 与三柱主结论方向或用神不同 */
  differs: boolean;
}

export interface NoHourScan {
  scan_slots: number;
  direction_agree: number;
  yong_agree: number;
  /** 仅按扫描比例得出的置信度（交节降级之前） */
  scan_confidence: Confidence;
  /** 最终置信度（含交节日降级） */
  confidence: Confidence;
  slots: NoHourSlot[];
  nohour_cong_possible: boolean;
  nohour_cong_hours: Zhi[];
  alt: NoHourAlt | null;
  notes: string[];
  rules_hit: RuleHit[];
}

/** 五鼠遁：日干序号 → 早子时天干序号 */
function ziStemOf(dayStem: number): number {
  return ((dayStem % 5) * 2) % 10;
}

/** 某日的 13 个扫描时柱（早子、丑…亥、晚子），顺序固定。 */
export function scanHourPillars(day: GanZhi): { slot: string; hour: GanZhi }[] {
  const dayStem = ganZhiIndex(day) % 10;
  const zi = ziStemOf(dayStem);
  const out: { slot: string; hour: GanZhi }[] = [{ slot: 'early-zi', hour: ganZhiOf(zi, 0) }];
  for (let z = 1; z < 12; z++) {
    out.push({ slot: ZHI_ORDER[z] as string, hour: ganZhiOf((zi + z) % 10, z) });
  }
  // 晚子按次日日干：次日早子干 = 当日早子干 + 2
  out.push({ slot: 'late-zi', hour: ganZhiOf(ziStemOf((dayStem + 1) % 10), 0) });
  return out;
}

export function confidenceOf(directionAgree: number, yongAgree: number, slots: number): Confidence {
  const d = directionAgree / slots;
  const y = yongAgree / slots;
  if (d >= CONF_HIGH_DIRECTION_MIN - FP_EPS && y >= CONF_HIGH_YONG_MIN - FP_EPS) return '高';
  if (d >= CONF_MID_DIRECTION_MIN - FP_EPS) return '中';
  return '低';
}

function conclusionText(level: StrengthLevel, ys: Yongshen): string {
  return `${level}，用神${ys.yong}，喜${ys.xi.join('')}，忌${ys.ji.join('')}`;
}

/**
 * 三柱扫描。chart.pillars.hour 必须为 null；base 为三柱主结论（analyze 中已算出，避免重复计算）。
 */
export function computeNoHourScan(
  chart: Pick<Chart, 'pillars' | 'uncertain'>,
  base: { strength: Strength; yongshen: Yongshen },
): NoHourScan {
  const { pillars } = chart;
  if (pillars.hour !== null) throw new Error('computeNoHourScan 只用于三柱命盘');
  const monthZhi = pillars.month[1] as Zhi;

  const slots: NoHourSlot[] = scanHourPillars(pillars.day).map(({ slot, hour }) => {
    const st = computeStrength({ ...pillars, hour });
    const ys = computeYongshen(st, monthZhi);
    return {
      slot,
      hour,
      S: st.S,
      level: st.level,
      direction: st.direction,
      special: st.special,
      yong: ys.yong,
    };
  });

  const scan_slots = slots.length;
  const direction_agree = slots.filter((s) => s.direction === base.strength.direction).length;
  const yong_agree = slots.filter((s) => s.yong === base.yongshen.yong).length;
  const scan_confidence = confidenceOf(direction_agree, yong_agree, scan_slots);

  const congZhi = new Set(slots.filter((s) => s.special !== null).map((s) => s.hour[1] as Zhi));
  const nohour_cong_hours = ZHI_ORDER.filter((z) => congZhi.has(z));
  const notes: string[] = [];
  if (nohour_cong_hours.length > 0) {
    notes.push(
      `若出生于${nohour_cong_hours.map((z) => `${z}时`).join('、')}，可能为从格，喜忌会相反`,
    );
  }

  // 交节日：另一组年月柱
  let alt: NoHourAlt | null = null;
  const mp = chart.uncertain.month_pillar;
  if (mp !== null) {
    const other = mp.find(([y, m]) => !(y === pillars.year && m === pillars.month));
    if (other === undefined) throw new Error('uncertain.month_pillar 中找不到另一组年月柱');
    const [y, m] = other;
    const altPillars = { year: y, month: m, day: pillars.day, hour: null };
    const st = computeStrength(altPillars);
    const ys = computeYongshen(st, m[1] as Zhi);
    const differs = st.direction !== base.strength.direction || ys.yong !== base.yongshen.yong;
    alt = {
      pillars: [y, m, pillars.day],
      S: st.S,
      level: st.level,
      direction: st.direction,
      yong: ys.yong,
      xi: [...ys.xi],
      ji: [...ys.ji],
      differs,
    };
    if (differs) {
      notes.push(
        `出生当天交节，结论有两种可能：按${pillars.year}年${pillars.month}月为${conclusionText(base.strength.level, base.yongshen)}；` +
          `按${y}年${m}月为${conclusionText(st.level, ys)}`,
      );
    }
  }

  const confidence: Confidence = alt?.differs ? '低' : scan_confidence;

  const rules_hit = [
    ruleHit('S-NOHOUR', confidence, {
      scan_slots,
      direction_agree,
      yong_agree,
      scan_confidence,
      cong_hours: nohour_cong_hours,
      jieqi_downgrade: alt?.differs ?? false,
    }),
  ];

  return {
    scan_slots,
    direction_agree,
    yong_agree,
    scan_confidence,
    confidence,
    slots,
    nohour_cong_possible: nohour_cong_hours.length > 0,
    nohour_cong_hours,
    alt,
    notes,
    rules_hit,
  };
}
