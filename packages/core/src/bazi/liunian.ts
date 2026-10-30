/**
 * 流年表（rules/calendar.md §8 末条、report-sections.md §8.2）。
 *
 * - 流年干支以立春换年：参考日期 refDate 落在某年立春交节时刻之前，仍属上一干支年（左闭右开，交节时刻本身属新年）。
 * - 起始年 = refDate 所在干支年，连续 LIUNIAN_YEAR_COUNT（5）年。
 * - refDate 由调用方传入，引擎不读系统时钟：免费页 = 当前时间；付费报告 = 订单创建时间（ARCHITECTURE §3.3），
 *   因此同一订单重看报告时流年起始年不变。
 * - 所在大运：流年跨两步大运时，取**立春交节时刻**所在的那一步（report-sections.md §8.2）。
 *   第 i 步大运（0 起）自「起运时刻 + 10·i 年」起，至下一步开始前止；起运时刻取 dayun.qiyunTime（精确到分钟），
 *   年份加 10·i、月日时分不变（2 月 29 日起运时，平年按字符串顺序落在 2 月 28 日与 3 月 1 日之间）。
 *   立春早于起运时刻 → 尚未起运，dayun = null；晚于第 8 步结束（起运后 80 年）→ 超出已排大运，dayun = null。
 */
import { solarTermMoment } from './calendar-adapter';
import { DAYUN_STEP_YEARS } from './dayun';
import { ganZhiAt } from './ganzhi';
import { formatBeijing, toBeijingParts } from './time';
import type { Dayun, LiunianYear } from './types';
import { SUPPORTED_RANGE_UTC_MS } from './year-month';

/** 流年表年数 */
export const LIUNIAN_YEAR_COUNT = 5;

/** tyme4ts 节气序号：3 = 立春 */
const LICHUN_INDEX = 3;

/** 公历 year 年立春交节绝对时刻（Unix 毫秒）。 */
export function lichunUtcMs(year: number): number {
  return solarTermMoment(year, LICHUN_INDEX).utcMs;
}

function assertRefDate(refUtcMs: number): void {
  if (
    !Number.isFinite(refUtcMs) ||
    refUtcMs < SUPPORTED_RANGE_UTC_MS.min ||
    refUtcMs >= SUPPORTED_RANGE_UTC_MS.max
  ) {
    throw new Error('参考日期不合法（须为 1900–2100 年内的绝对时刻）');
  }
}

/** 参考日期所在的干支年（以立春为界），用公历年份数字表示。 */
export function liunianStartYear(refUtcMs: number): number {
  assertRefDate(refUtcMs);
  const y = toBeijingParts(refUtcMs).year;
  return refUtcMs < lichunUtcMs(y) ? y - 1 : y;
}

/** 'YYYY-MM-DD HH:MM' 年份替换为 year。 */
const withYear = (time: string, year: number) => `${String(year).padStart(4, '0')}${time.slice(4)}`;

/**
 * 某一时刻（北京时间 'YYYY-MM-DD HH:MM:SS'）所在的大运干支；尚未起运或超出 8 步为 null。
 */
export function dayunAtBeijing(dayun: Dayun, beijing: string): LiunianYear['dayun'] {
  const moment = beijing.slice(0, 16); // 精确到分钟，与 qiyunTime 同口径
  const qiyunYear = Number(dayun.qiyunTime.slice(0, 4));
  let found: LiunianYear['dayun'] = null;
  for (let i = 0; i < dayun.steps.length; i++) {
    const start = withYear(dayun.qiyunTime, qiyunYear + DAYUN_STEP_YEARS * i);
    if (moment >= start) found = (dayun.steps[i] as Dayun['steps'][number]).ganzhi;
  }
  if (found === null) return null;
  const end = withYear(dayun.qiyunTime, qiyunYear + DAYUN_STEP_YEARS * dayun.steps.length);
  return moment >= end ? null : found;
}

/**
 * 流年表：从 refDate 所在干支年起连续 count 年。
 * @param refUtcMs 参考日期（绝对时刻，Unix 毫秒）
 * @param dayun computeDayun 的结果
 */
export function computeLiunian(
  refUtcMs: number,
  dayun: Dayun,
  count: number = LIUNIAN_YEAR_COUNT,
): LiunianYear[] {
  const startYear = liunianStartYear(refUtcMs);
  const list: LiunianYear[] = [];
  for (let i = 0; i < count; i++) {
    const year = startYear + i;
    const lichun = formatBeijing(lichunUtcMs(year));
    list.push({
      year,
      ganzhi: ganZhiAt(year - 4), // 公元 4 年为甲子年
      lichun,
      dayun: dayunAtBeijing(dayun, lichun),
    });
  }
  return list;
}
