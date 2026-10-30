/**
 * CAL-YM：年柱、月柱（rules/calendar.md §1、§2）。
 *
 * - 年柱以立春交节时刻为界（CAL-YM-1）；月柱以十二「节」交节时刻为界（CAL-YM-2），中气不换月。
 * - 用出生的**绝对时刻**与节气的绝对时刻比较（精确到秒）；真太阳时不参与。
 * - 交节时刻本身属于新的月（左闭右开）。
 * - 月干用五虎遁：甲己丙寅、乙庚戊寅、丙辛庚寅、丁壬壬寅、戊癸甲寅。
 */
import { solarTermMoment, type SolarTermMoment } from './calendar-adapter';
import { BaziError } from './errors';
import { ganZhiAt, ganZhiOf, type GanZhi } from './ganzhi';
import { formatBeijing, fromBeijingParts, toBeijingParts } from './time';
import type { JieqiMoment } from './types';

/** 支持的出生时刻范围（北京标准时间 1900-01-01 00:00:00 起，至 2100-12-31 23:59:59 止）。 */
export const SUPPORTED_RANGE_UTC_MS = {
  min: fromBeijingParts({ year: 1900, month: 1, day: 1, hour: 0, minute: 0, second: 0 }),
  /** 不含 */
  max: fromBeijingParts({ year: 2101, month: 1, day: 1, hour: 0, minute: 0, second: 0 }),
} as const;

export interface YearMonthResult {
  year: GanZhi;
  month: GanZhi;
  /** 出生前最近一个「节」（名称 + 北京标准时间） */
  jieqi_prev: JieqiMoment;
  /** 出生后第一个「节」 */
  jieqi_next: JieqiMoment;
  rules_hit: string[];
}

/** 北京公历 Y 年内及前后相邻的全部「节」，按时间升序：Y-1 年大雪、Y 年小寒 … 大雪、Y+1 年小寒。 */
function jieListAround(year: number): SolarTermMoment[] {
  const list: SolarTermMoment[] = [solarTermMoment(year - 1, 23)];
  for (let i = 1; i <= 23; i += 2) list.push(solarTermMoment(year, i));
  list.push(solarTermMoment(year + 1, 1));
  return list;
}

/** 以立春为岁首的干支年份（公历数字）：小寒（1 月）仍属上一年，立春…大雪属当年。 */
function ganzhiYearOf(jie: SolarTermMoment): number {
  return jie.index >= 3 ? jie.year : jie.year - 1;
}

/** 节 → 月序（0 = 寅月/立春 … 10 = 子月/大雪，11 = 丑月/小寒）。 */
function monthOrdinalOf(jie: SolarTermMoment): number {
  return ((((jie.index - 3) / 2) % 12) + 12) % 12;
}

/** 五虎遁：年干序号 → 寅月天干序号。 */
function yinMonthStem(yearStem: number): number {
  return ((yearStem % 5) * 2 + 2) % 10;
}

const toMoment = (j: SolarTermMoment): JieqiMoment => ({
  name: j.name,
  time: formatBeijing(j.utcMs),
});

/**
 * 由出生绝对时刻（Unix 毫秒）求年柱、月柱及前后两个「节」。
 * @throws BaziError E_DATE_OUT_OF_RANGE
 */
export function computeYearMonth(utcMs: number): YearMonthResult {
  if (
    !Number.isFinite(utcMs) ||
    utcMs < SUPPORTED_RANGE_UTC_MS.min ||
    utcMs >= SUPPORTED_RANGE_UTC_MS.max
  ) {
    throw new BaziError('E_DATE_OUT_OF_RANGE', '出生时间超出支持范围（1900–2100 年）');
  }
  const list = jieListAround(toBeijingParts(utcMs).year);
  // 最后一个交节时刻 <= 出生时刻的「节」。list[0] 是上一年 12 月大雪，必然 <= 本年任意时刻。
  let k = 0;
  while (k + 1 < list.length && (list[k + 1] as SolarTermMoment).utcMs <= utcMs) k++;
  const prev = list[k] as SolarTermMoment;
  const next = list[k + 1];
  if (next === undefined) throw new Error('节气表不完整');

  const yearIdx = ganzhiYearOf(prev) - 4; // 公元 4 年为甲子年
  const year = ganZhiAt(yearIdx);
  const yearStem = ((yearIdx % 10) + 10) % 10;
  const m = monthOrdinalOf(prev);
  const month = ganZhiOf(yinMonthStem(yearStem) + m, 2 + m);

  return {
    year,
    month,
    jieqi_prev: toMoment(prev),
    jieqi_next: toMoment(next),
    rules_hit: ['CAL-YM-1', 'CAL-YM-2'],
  };
}
