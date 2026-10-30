/**
 * CAL-TST：真太阳时（rules/calendar.md §4）。
 *
 * 硬性规则：
 * - 只有用户主动选了出生地（传入经度）才校正，tst_status = '已校正'；
 * - 没选出生地：直接用 CAL-TZ 换算出的 UTC+8 标准时（北京标准时间），不做任何校正、不猜测出生地，
 *   tst_status = '未校正'；若出生时刻离时辰边界（奇数整点）不足 30 分钟，置 near_shichen_boundary = true
 *   （仅供结果页提示，不改变排盘）。
 *
 * 公式：
 *   平太阳时 = UTC + 经度 × 4 分钟（东经为正）
 *   真太阳时 = 平太阳时 + 均时差 EoT(UTC)
 *   EoT 用 NOAA 近似式（分钟，误差 < 1 分钟）：
 *     g   = 2π/365 × (年内第几天 − 1 + (UTC 小时 − 12)/24)
 *     EoT = 229.18 × (0.000075 + 0.001868 cos g − 0.032077 sin g − 0.014615 cos 2g − 0.040849 sin 2g)
 *   「年内第几天」「UTC 小时」都取 UTC 日期时间；按 calendar.md 原式一律除以 365（闰年不改）。
 *
 * 输出的「当地时间」只用于日柱、时柱（CAL-DH）；年柱、月柱用绝对时刻比节气（CAL-YM-2），与本模块无关。
 * 计算内部保留毫秒精度；展示字符串截断到分钟（与 cases.json derived.true_solar_time 一致）。
 */
import { BaziError } from './errors';
import { BEIJING_STANDARD_OFFSET_MS, type DateTimeParts } from './time';
import type { TrueSolarTime, TstStatus } from './types';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** 经度修正的基准经线：北京标准时间对应东经 120°。 */
export const BEIJING_MERIDIAN = 120;

/** 未校正时，离时辰边界不足此分钟数则提示。 */
export const NEAR_BOUNDARY_MINUTES = 30;

export interface TrueSolarTimeResult {
  tst_status: TstStatus;
  /** 仅已校正时存在（Chart.true_solar_time） */
  true_solar_time: TrueSolarTime | null;
  /**
   * 用于日柱、时柱的当地时间，按「把当地时间各字段当作 UTC」编码的毫秒数
   * （即 new Date(localMs).getUTCHours() 等于当地小时）。
   * 已校正 = 真太阳时；未校正 = 北京标准时间。
   */
  localMs: number;
  /** localMs 的各字段（秒以下截断） */
  local: DateTimeParts;
  /** 未校正且离时辰边界（奇数整点）不足 30 分钟；已校正时恒为 false */
  near_shichen_boundary: boolean;
  rules_hit: string[];
}

/** 年内第几天（1 起），按 UTC 日期。 */
function dayOfYearUtc(utcMs: number): number {
  const d = new Date(utcMs);
  return Math.floor((utcMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

/** NOAA 近似均时差（分钟），参数为绝对时刻。 */
export function equationOfTimeMinutes(utcMs: number): number {
  const d = new Date(utcMs);
  const hour =
    d.getUTCHours() +
    d.getUTCMinutes() / 60 +
    d.getUTCSeconds() / 3600 +
    d.getUTCMilliseconds() / 3_600_000;
  const g = ((2 * Math.PI) / 365) * (dayOfYearUtc(utcMs) - 1 + (hour - 12) / 24);
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

/** 经度修正（分钟，相对东经 120°）：(经度 − 120) × 4。东经为正。 */
export function longitudeCorrectionMinutes(longitude: number): number {
  return (longitude - BEIJING_MERIDIAN) * 4;
}

function partsOf(localMs: number): DateTimeParts {
  const d = new Date(Math.floor(localMs / 1000) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 当地时间编码毫秒 → 'YYYY-MM-DD HH:MM'（截断到分钟）。 */
function formatLocalMinute(localMs: number): string {
  const p = partsOf(localMs);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const round2 = (x: number) => Math.round(x * 100) / 100 + 0; // + 0 把 -0 变成 0

/**
 * 当地时间离最近的时辰边界（奇数整点：23:00、01:00、03:00 …）的分钟数。
 * 时辰左闭右开，边界本身距离为 0。
 */
export function minutesToShichenBoundary(localMs: number): number {
  const minuteOfDay = (((localMs % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS;
  const sinceBoundary = (((minuteOfDay - 60) % 120) + 120) % 120;
  return Math.min(sinceBoundary, 120 - sinceBoundary);
}

/**
 * 计算日柱、时柱所用的当地时间。
 * @param utcMs 出生绝对时刻（CAL-TZ 的输出）
 * @param longitude 出生地经度（东经为正，度）；null = 用户未选出生地，不校正
 */
export function computeTrueSolarTime(utcMs: number, longitude: number | null): TrueSolarTimeResult {
  const beijingMs = utcMs + BEIJING_STANDARD_OFFSET_MS;

  if (longitude === null) {
    return {
      tst_status: '未校正',
      true_solar_time: null,
      localMs: beijingMs,
      local: partsOf(beijingMs),
      near_shichen_boundary: minutesToShichenBoundary(beijingMs) < NEAR_BOUNDARY_MINUTES,
      rules_hit: ['CAL-TST'],
    };
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new BaziError('E_INVALID_LONGITUDE', '出生地经度无效');
  }

  const lonMin = longitudeCorrectionMinutes(longitude);
  const eotMin = equationOfTimeMinutes(utcMs);
  // 真太阳时 = UTC + 经度×4 分钟 + 均时差 = 北京标准时间 + (经度−120)×4 分钟 + 均时差
  const localMs = Math.round(beijingMs + (lonMin + eotMin) * MIN_MS);

  return {
    tst_status: '已校正',
    true_solar_time: {
      beijingTime: formatLocalMinute(beijingMs),
      trueSolarTime: formatLocalMinute(localMs),
      longitudeCorrectionMin: round2(lonMin),
      equationOfTimeMin: round2(eotMin),
    },
    localMs,
    local: partsOf(localMs),
    near_shichen_boundary: false,
    rules_hit: ['CAL-TST'],
  };
}
