/**
 * CAL-YUN：起运与大运（rules/calendar.md §8）。
 *
 * - 顺逆：阳年男、阴年女顺排；阴年男、阳年女逆排。阴阳看年柱天干（甲丙戊庚壬为阳），年柱以立春为界
 *   （直接使用 year-month.ts 的年柱，已按立春交节时刻划分）。
 * - 大运干支：从月柱起，顺排取下一个干支、逆排取上一个，每步 10 年，排 8 步。
 * - 起运：顺排数出生到下一个「节」、逆排数到上一个「节」的时间，都用绝对时刻（精确到秒）。
 *   按分钟折算（Sect2，对应 lunar 库 getYun(gender, 2) / tyme4ts LunarSect2ChildLimitProvider）：
 *     总分钟数 = ⌊|节 − 出生| 秒 / 60⌋；
 *     3 天（4320 分钟）= 1 年；1 天剩余部分里每 6 小时（360 分钟）= 1 个月；每 12 分钟 = 1 天；每 1 分钟 = 2 小时。
 * - 起运日期 = 出生时刻 + 折算出的年、月、日、时。出生时刻取**北京标准时间**（由绝对时刻换算，UTC+8、无夏令时），
 *   与节气时刻、lunar / tyme4ts 的口径一致；不用真太阳时（真太阳时只用于日柱、时柱）。
 *   加法规则：年、月先按日历进位，日数超过当月天数时顺延到下月（与 lunar / tyme4ts 相同）。
 * - 第 n 步大运开始年份 = 起运日期所在公历年 + 10 × (n − 1)；结束年份 = 开始年份 + 9。
 * - 年龄：对外一律用周岁（起运日期时的实足年龄：起运年 − 出生年，起运日期的月日早于出生月日再减 1）；
 *   内部保留虚岁（开始年份 − 出生公历年 + 1，与 cases.json start_age_xusui 口径一致）。
 */
import { ganZhiAt, ganZhiIndex, TIAN_GAN, type Gan, type GanZhi } from './ganzhi';
import { toBeijingParts, type DateTimeParts } from './time';
import type { Dayun, DayunStep, Gender, QiyunOffset } from './types';
import type { YearMonthResult } from './year-month';

/** 排几步大运 */
export const DAYUN_STEP_COUNT = 8;
/** 每步大运年数 */
export const DAYUN_STEP_YEARS = 10;

/** 折算常量（分钟）：3 天 = 1 年；6 小时 = 1 个月；12 分钟 = 1 天；1 分钟 = 2 小时。 */
const MIN_PER_YEAR = 3 * 24 * 60;
const MIN_PER_MONTH = 6 * 60;
const MIN_PER_DAY = 12;
const HOURS_PER_MIN = 2;

export interface DayunOptions {
  /** 三柱模式按 12:00 计算时为 true（「约 X 岁起运」，CAL-NOHOUR，T11） */
  approximate?: boolean;
}

export interface DayunResult {
  dayun: Dayun;
  /** 起运所数的那个「节」（顺排为下一个节，逆排为上一个节） */
  qiyunJie: { name: string; time: string };
  rules_hit: string[];
}

/** 年干是否为阳干（甲丙戊庚壬）。 */
export function isYangGan(g: Gan): boolean {
  return TIAN_GAN.indexOf(g) % 2 === 0;
}

/** 顺逆：阳男阴女顺，阴男阳女逆。 */
export function dayunDirection(yearPillar: GanZhi, gender: Gender): '顺' | '逆' {
  const yang = isYangGan(Array.from(yearPillar)[0] as Gan);
  return yang === (gender === '男') ? '顺' : '逆';
}

/** 出生到节的间隔（毫秒，取绝对值）→ 起运间隔（按分钟折算）。 */
export function qiyunOffsetOf(diffMs: number): QiyunOffset {
  let minutes = Math.floor(Math.floor(Math.abs(diffMs) / 1000) / 60);
  const years = Math.floor(minutes / MIN_PER_YEAR);
  minutes %= MIN_PER_YEAR;
  const months = Math.floor(minutes / MIN_PER_MONTH);
  minutes %= MIN_PER_MONTH;
  const days = Math.floor(minutes / MIN_PER_DAY);
  minutes %= MIN_PER_DAY;
  return { years, months, days, hours: minutes * HOURS_PER_MIN };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 出生时刻（北京标准时间各字段）+ 起运间隔 → 起运时刻。
 * 小时满 24 进日；年、月按日历进位；日数超过当月天数时顺延到下月（如 1 月 31 日 + 1 个月 → 3 月 2 / 3 日）。
 */
export function addQiyunOffset(birth: DateTimeParts, off: QiyunOffset): DateTimeParts {
  let hour = birth.hour + off.hours;
  let day = birth.day + off.days + Math.floor(hour / 24);
  hour %= 24;
  const m0 = birth.month - 1 + off.months;
  let year = birth.year + off.years + Math.floor(m0 / 12);
  let month = (m0 % 12) + 1;
  let dim = daysInMonth(year, month);
  while (day > dim) {
    day -= dim;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    dim = daysInMonth(year, month);
  }
  return { year, month, day, hour, minute: birth.minute, second: birth.second };
}

/** 周岁：到 at 这一天为止的实足年龄（只比较月日）。 */
export function zhousuiAt(birth: DateTimeParts, at: DateTimeParts): number {
  const beforeBirthday = at.month < birth.month || (at.month === birth.month && at.day < birth.day);
  return at.year - birth.year - (beforeBirthday ? 1 : 0);
}

/**
 * 第 i 步（0 起）大运干支，i 可超过 DAYUN_STEP_COUNT − 1：按同一顺逆规则从第 1 步继续顺推 / 逆推。
 * 内部用于高龄用户的流年「所在大运」归属；对外的大运表仍只有 8 步。
 */
export function dayunStepGanzhi(dayun: Dayun, i: number): GanZhi {
  if (!Number.isInteger(i) || i < 0) throw new Error('大运步序不合法');
  const first = dayun.steps[0];
  if (first === undefined) throw new Error('大运表为空');
  return ganZhiAt(ganZhiIndex(first.ganzhi) + (dayun.direction === '顺' ? i : -i));
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * 起运与 8 步大运。
 * @param utcMs 出生绝对时刻（Unix 毫秒，CAL-TZ 的结果）
 * @param gender 性别
 * @param ym 同一时刻的年柱、月柱及前后两个「节」（computeYearMonth(utcMs) 的结果）
 */
export function computeDayun(
  utcMs: number,
  gender: Gender,
  ym: YearMonthResult,
  options: DayunOptions = {},
): DayunResult {
  const direction = dayunDirection(ym.year, gender);
  const forward = direction === '顺';
  const jieUtcMs = forward ? ym.jieqiNextUtcMs : ym.jieqiPrevUtcMs;
  const jie = forward ? ym.jieqi_next : ym.jieqi_prev;

  const qiyunOffset = qiyunOffsetOf(jieUtcMs - utcMs);
  const birth = toBeijingParts(utcMs);
  const q = addQiyunOffset(birth, qiyunOffset);
  const qiyunDate = `${pad(q.year, 4)}-${pad(q.month)}-${pad(q.day)}`;
  const qiyunAge = zhousuiAt(birth, q);

  const monthIdx = ganZhiIndex(ym.month);
  const steps: DayunStep[] = [];
  for (let i = 0; i < DAYUN_STEP_COUNT; i++) {
    const startYear = q.year + DAYUN_STEP_YEARS * i;
    steps.push({
      ganzhi: ganZhiAt(monthIdx + (forward ? i + 1 : -(i + 1))),
      startYear,
      endYear: startYear + DAYUN_STEP_YEARS - 1,
      startAge: qiyunAge + DAYUN_STEP_YEARS * i,
      startAgeXusui: startYear - birth.year + 1,
    });
  }

  return {
    dayun: {
      direction,
      qiyunOffset,
      qiyunTime: `${qiyunDate} ${pad(q.hour)}:${pad(q.minute)}`,
      qiyunDate,
      qiyunAge,
      approximate: options.approximate ?? false,
      steps,
    },
    qiyunJie: jie,
    rules_hit: ['CAL-YUN'],
  };
}
