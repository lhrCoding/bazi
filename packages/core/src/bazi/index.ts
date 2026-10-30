/**
 * ① 排盘引擎（纯函数）。calendar-adapter.ts 是唯一 import tyme4ts 的文件。
 */
export * from './ganzhi';
export type * from './types';
export * from './errors';
export { computeYearMonth, SUPPORTED_RANGE_UTC_MS, type YearMonthResult } from './year-month';
export { clockToUtc, DEFAULT_TIMEZONE, type ClockToUtcResult } from './clock';
export {
  computeTrueSolarTime,
  equationOfTimeMinutes,
  longitudeCorrectionMinutes,
  minutesToShichenBoundary,
  BEIJING_MERIDIAN,
  NEAR_BOUNDARY_MINUTES,
  type TrueSolarTimeResult,
} from './true-solar-time';
export {
  computeDayHour,
  dayPillarIndex,
  dayPillarOf,
  shichenIndex,
  DAY_PILLAR_EPOCH,
  type DayHourResult,
} from './day-hour';
export {
  leapMonthOf,
  lunarDayLabel,
  lunarMonthLabel,
  lunarMonthsOf,
  lunarToSolar,
  resolveSolarDate,
  validateSolarDate,
  LUNAR_YEAR_RANGE,
  SOLAR_DATE_RANGE,
  type LunarMonthOption,
  type ResolvedSolarDate,
} from './lunar-input';
export {
  addQiyunOffset,
  computeDayun,
  dayunDirection,
  isYangGan,
  qiyunOffsetOf,
  zhousuiAt,
  DAYUN_STEP_COUNT,
  DAYUN_STEP_YEARS,
  type DayunOptions,
  type DayunResult,
} from './dayun';
