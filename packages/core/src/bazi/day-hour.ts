/**
 * CAL-DH：日柱、时柱（rules/calendar.md §3）。
 *
 * - 输入是 CAL-TST 得到的「当地时间」各字段（选了出生地 = 真太阳时；未选 = 北京标准时间），
 *   年柱、月柱与本模块无关（它们用绝对时刻比节气）。
 * - 日柱：60 甲子连续计数，参考点 2000-01-01 = 戊午日（甲子序号 54）；日柱在 24:00（午夜）换。
 * - 时柱：十二时辰左闭右开（子 23:00–00:59，丑 01:00–02:59 …… 亥 21:00–22:59）；
 *   时干五鼠遁：甲己日甲子、乙庚日丙子、丙辛日戊子、丁壬日庚子、戊癸日壬子。
 * - CAL-DH-ZI 早晚子时派（本项目采用，用户 2026-10-29 拍板）：
 *   · 00:00–00:59 早子时：当日日柱，时干按当日日干起；
 *   · 23:00–23:59 晚子时：日柱仍为当日，时干按**次日**日干起（= 当日子时干 + 2）。
 * - alt.zi_huanri_day_pillar：23:00 换日派（不采用）的日柱，仅 23:00–23:59 时为次日日柱，其余与主结果相同。
 *   两派时柱完全相同。
 */
import { ganZhiAt, ganZhiOf, type GanZhi } from './ganzhi';
import type { DateTimeParts } from './time';

const DAY_MS = 86_400_000;

/** 2000-01-01 戊午日在 60 甲子中的序号（甲子 = 0）。 */
export const DAY_PILLAR_EPOCH = { year: 2000, month: 1, day: 1, index: 54 } as const;

const EPOCH_DAY_NUMBER =
  Date.UTC(DAY_PILLAR_EPOCH.year, DAY_PILLAR_EPOCH.month - 1, DAY_PILLAR_EPOCH.day) / DAY_MS;

/** 公历日期 → 60 甲子序号（0 = 甲子），按前推格里历连续计数。 */
export function dayPillarIndex(year: number, month: number, day: number): number {
  const dayNumber = Date.UTC(year, month - 1, day) / DAY_MS;
  const i = DAY_PILLAR_EPOCH.index + (dayNumber - EPOCH_DAY_NUMBER);
  return ((i % 60) + 60) % 60;
}

/** 公历日期 → 日柱。 */
export function dayPillarOf(year: number, month: number, day: number): GanZhi {
  return ganZhiAt(dayPillarIndex(year, month, day));
}

/** 小时（0–23）→ 时辰地支序号（子 0、丑 1 …… 亥 11）。 */
export function shichenIndex(hour: number): number {
  return Math.floor((hour + 1) / 2) % 12;
}

/** 五鼠遁：日干序号 → 该日子时（早子时）天干序号。 */
function ziHourStem(dayStem: number): number {
  return ((dayStem % 5) * 2) % 10;
}

export interface DayHourResult {
  day: GanZhi;
  hour: GanZhi;
  /** 23:00 换日派（不采用）的日柱 */
  zi_huanri_day_pillar: GanZhi;
  /** 是否晚子时（23:00–23:59） */
  late_zi: boolean;
  rules_hit: string[];
}

function assertParts(p: DateTimeParts): void {
  const ok =
    Number.isInteger(p.year) &&
    Number.isInteger(p.month) &&
    Number.isInteger(p.day) &&
    Number.isInteger(p.hour) &&
    p.month >= 1 &&
    p.month <= 12 &&
    p.day >= 1 &&
    p.day <= 31 &&
    p.hour >= 0 &&
    p.hour <= 23;
  if (!ok) throw new Error('日柱时柱输入的当地时间不合法');
}

/**
 * 由当地时间（CAL-TST 输出的 local）求日柱、时柱（早晚子时派）。
 */
export function computeDayHour(local: DateTimeParts): DayHourResult {
  assertParts(local);
  const dayIdx = dayPillarIndex(local.year, local.month, local.day);
  const day = ganZhiAt(dayIdx);
  const lateZi = local.hour === 23;
  const zhi = shichenIndex(local.hour);
  // 晚子时按次日日干起：次日日干 = 当日日干 + 1，其子时干 = 当日子时干 + 2。
  const stemDay = lateZi ? dayIdx + 1 : dayIdx;
  const hour = ganZhiOf(ziHourStem(stemDay % 10) + zhi, zhi);
  // 子时（早子 / 晚子）命中 CAL-DH-ZI
  const rules_hit = zhi === 0 ? ['CAL-DH', 'CAL-DH-ZI'] : ['CAL-DH'];
  return {
    day,
    hour,
    zi_huanri_day_pillar: lateZi ? ganZhiAt(dayIdx + 1) : day,
    late_zi: lateZi,
    rules_hit,
  };
}
