/**
 * CAL-INPUT：农历（含闰月）→ 公历；公历 / 农历非法日期校验。rules/calendar.md §6。
 *
 * - 农历只用于输入：先换成公历日期，之后所有计算与公历输入完全相同（时间 'HH:MM' 原样沿用）。
 *   四柱与农历月份无关，闰月不等于某个月柱（月柱只看节气，C07）。
 * - 换算由 tyme4ts 完成（经 calendar-adapter.ts），本文件只做校验与组装，不自行推算农历。
 * - 非法日期返回错误码（错误信息不含输入值）：
 *   · 格式错误、公历日期不存在（2 月 30 日）、农历月不在 1–12 / 日不在 1–30 → E_INVALID_DATETIME
 *   · 所选农历年份没有该闰月 → E_LUNAR_NO_LEAP
 *   · 农历小月三十 → E_LUNAR_DAY_OVERFLOW
 *   · 换算后公历日期不在 1900-01-01 至 2100-12-31 → E_DATE_OUT_OF_RANGE
 * - 另提供「某年是否有闰月、闰几月」及月份下拉选项，供表单使用（UI.md：正月……腊月，有闰月时插入「闰X月」）。
 */
import { lunarLeapMonth, lunarMonthDayCount, lunarToSolarParts } from './calendar-adapter';
import { BaziError } from './errors';
import type { BirthInput } from './types';

/**
 * 支持的农历年份。公历 1900-01-01 是农历己亥年（1899）腊月初一，所以下限为 1899；
 * 农历 2100 年腊月末已进入公历 2101 年，这部分日期换算后按 E_DATE_OUT_OF_RANGE 拒绝。
 */
export const LUNAR_YEAR_RANGE = { min: 1899, max: 2100 } as const;

/** 支持的公历出生日期（含两端），与 year-month.ts 的 SUPPORTED_RANGE_UTC_MS 一致。 */
export const SOLAR_DATE_RANGE = { min: '1900-01-01', max: '2100-12-31' } as const;

const MONTH_NAMES = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
] as const;

const DAY_TENS = ['初', '十', '廿', '三'] as const;
const DAY_UNITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatYmd(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function parseYmd(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new BaziError('E_INVALID_DATETIME', '出生日期格式不正确');
  return m.slice(1).map(Number) as [number, number, number];
}

function assertLunarYear(year: number): void {
  if (!Number.isInteger(year) || year < LUNAR_YEAR_RANGE.min || year > LUNAR_YEAR_RANGE.max) {
    throw new BaziError('E_DATE_OUT_OF_RANGE', '农历年份超出支持范围');
  }
}

function assertSolarInRange(ymd: string): void {
  // 'YYYY-MM-DD' 定长，字典序即时间序
  if (ymd < SOLAR_DATE_RANGE.min || ymd > SOLAR_DATE_RANGE.max) {
    throw new BaziError('E_DATE_OUT_OF_RANGE', '出生日期超出支持范围（1900–2100 年）');
  }
}

// ---------- 表单用查询 ----------

/** 农历某年的闰月月份（1–12）；该年没有闰月返回 null。 */
export function leapMonthOf(year: number): number | null {
  assertLunarYear(year);
  const m = lunarLeapMonth(year);
  return m === 0 ? null : m;
}

/** 农历月份名称：正月……腊月；闰月加「闰」字（如「闰二月」）。 */
export function lunarMonthLabel(month: number, isLeap = false): string {
  const name = MONTH_NAMES[month - 1];
  if (name === undefined) throw new BaziError('E_INVALID_DATETIME', '农历月份不存在');
  return isLeap ? `闰${name}` : name;
}

/** 农历日名称：初一……初十、十一……二十、廿一……三十。 */
export function lunarDayLabel(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    throw new BaziError('E_INVALID_DATETIME', '农历日期不存在');
  }
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return `${DAY_TENS[Math.floor(day / 10)]}${DAY_UNITS[(day % 10) - 1]}`;
}

export interface LunarMonthOption {
  /** 月份数字 1–12（闰月与所闰的月份相同） */
  month: number;
  isLeap: boolean;
  /** 下拉显示文字，如「二月」「闰二月」 */
  label: string;
  /** 该月天数（29 或 30），日下拉据此决定是否出现「三十」 */
  dayCount: number;
}

/** 农历某年的全部月份（按时间顺序，闰月紧跟在所闰月份之后），供表单月份下拉使用。 */
export function lunarMonthsOf(year: number): LunarMonthOption[] {
  const leap = leapMonthOf(year);
  const out: LunarMonthOption[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      month: m,
      isLeap: false,
      label: lunarMonthLabel(m),
      dayCount: lunarMonthDayCount(year, m, false),
    });
    if (m === leap) {
      out.push({
        month: m,
        isLeap: true,
        label: lunarMonthLabel(m, true),
        dayCount: lunarMonthDayCount(year, m, true),
      });
    }
  }
  return out;
}

// ---------- 换算与校验 ----------

/**
 * 农历日期 → 公历日期 'YYYY-MM-DD'。
 * @param month 1–12（不含闰字，闰月由 isLeap 表示）
 */
export function lunarToSolar(year: number, month: number, day: number, isLeap: boolean): string {
  assertLunarYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BaziError('E_INVALID_DATETIME', '农历月份不存在');
  }
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    throw new BaziError('E_INVALID_DATETIME', '农历日期不存在');
  }
  if (isLeap && lunarLeapMonth(year) !== month) {
    throw new BaziError('E_LUNAR_NO_LEAP', '所选农历年份没有这个闰月');
  }
  if (day > lunarMonthDayCount(year, month, isLeap)) {
    throw new BaziError('E_LUNAR_DAY_OVERFLOW', '该农历月是小月，没有三十');
  }
  const s = lunarToSolarParts(year, month, day, isLeap);
  const ymd = formatYmd(s.year, s.month, s.day);
  assertSolarInRange(ymd);
  return ymd;
}

/** 校验公历日期 'YYYY-MM-DD' 存在且在支持范围内，原样返回。 */
export function validateSolarDate(date: string): string {
  const [y, m, d] = parseYmd(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    throw new BaziError('E_INVALID_DATETIME', '出生日期不存在');
  }
  assertSolarInRange(date);
  return date;
}

export interface ResolvedSolarDate {
  /** 公历日期 'YYYY-MM-DD'，后续 CAL-TZ 等步骤一律用它 */
  solarDate: string;
  /** 农历输入时为 ['CAL-INPUT']，公历输入为空 */
  rules_hit: string[];
}

/**
 * CAL-INPUT 入口：BirthInput 的日期部分 → 公历日期。
 * - calendar = 'solar'：校验日期存在；isLeapMonth 不得为 true（公历没有闰月，视为输入错误）。
 * - calendar = 'lunar'：date 为农历年月日（月份不含闰字），isLeapMonth 表示闰月。
 */
export function resolveSolarDate(
  input: Pick<BirthInput, 'calendar' | 'date' | 'isLeapMonth'>,
): ResolvedSolarDate {
  if (input.calendar === 'solar') {
    if (input.isLeapMonth === true) {
      throw new BaziError('E_INVALID_DATETIME', '公历日期不应标记闰月');
    }
    return { solarDate: validateSolarDate(input.date), rules_hit: [] };
  }
  if (input.calendar === 'lunar') {
    const [y, m, d] = parseYmd(input.date);
    return {
      solarDate: lunarToSolar(y, m, d, input.isLeapMonth === true),
      rules_hit: ['CAL-INPUT'],
    };
  }
  throw new BaziError('E_INVALID_DATETIME', '历法类型不正确');
}
