/**
 * CAL-NOHOUR：不知道时辰（三柱模式，rules/calendar.md §7）。
 *
 * - 只排年、月、日三柱；时柱及时柱相关字段（藏干、十神）一律为 null，hourKnown = false。
 * - 日柱按用户填的日期（早晚子时派下 23:00 本来也不换日，无需特殊处理）。
 * - 默认计算时刻 = 出生日当天 12:00 本地钟表时间（经 CAL-TZ 换成绝对时刻；中国大陆 1986–1991 年夏令时期间
 *   即为钟表 12:00，与 cases.json 的约定一致）。年柱、月柱与起运都用这个时刻；起运标记 approximate（「约 X 岁起运」）。
 * - 出生日当天（本地 00:00 至次日 00:00，左闭右开）有「节」交接时（交节时刻严格晚于当天 00:00；恰在 00:00 交节则
 *   全天都在交节后，不算交节日）：
 *   · jieqiChoice = 'unsure' 或 null：按 12:00 计算，并输出 uncertain.month_pillar = [交节前年月柱, 交节后年月柱]
 *     与交节时刻（北京标准时间），由结果页提示用户补充；
 *   · 'before' / 'after'：取用户所选一侧的年月柱，uncertain 为 null。计算时刻：12:00 若落在所选一侧即用 12:00；
 *     否则取所选一侧当天时段的中点（精确到秒），使起运误差最小。
 * - 当天无交节时 jieqiChoice 不起作用。
 * - 13 个时柱扫描（S-NOHOUR）属于规则引擎（T18），不在本模块。
 */
import { clockToUtc } from './clock';
import { dayPillarOf } from './day-hour';
import { computeDayun, type DayunResult } from './dayun';
import { BaziError } from './errors';
import type { GanZhi } from './ganzhi';
import { formatBeijing } from './time';
import type { Gender, JieqiChoice, JieqiMoment } from './types';
import { computeYearMonth, type YearMonthResult } from './year-month';

/** 三柱模式默认计算时间（本地钟表） */
export const NO_HOUR_DEFAULT_TIME = '12:00';

export interface NoHourResult {
  hourKnown: false;
  /** 实际用于年月柱、起运的绝对时刻（Unix 毫秒） */
  utcMs: number;
  /** 采用的年柱、月柱及前后两个节 */
  ym: YearMonthResult;
  day: GanZhi;
  hour: null;
  /** 出生日当天交接的「节」（名称 + 北京标准时间）；当天无交节为 null */
  jieqiOnBirthday: JieqiMoment | null;
  /** 当天有交节时实际采用的一侧：用户选择，或 unsure / null 时按 12:00 所在一侧 */
  side: 'before' | 'after' | null;
  uncertain: {
    month_pillar: [[GanZhi, GanZhi], [GanZhi, GanZhi]] | null;
    jieqi_time: string | null;
  };
  dayun: DayunResult;
  rules_hit: string[];
}

const SECOND_MS = 1000;

function nextDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new BaziError('E_INVALID_DATETIME', '出生日期格式不正确');
  const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

/** 本地日期的 00:00 绝对时刻；个别海外时区午夜恰逢夏令时跳变时，取当天第一个存在的整点。 */
function localMidnightUtcMs(date: string, timezone: string): number {
  for (const t of ['00:00', '01:00', '02:00']) {
    try {
      return clockToUtc(date, t, timezone).utcMs;
    } catch (e) {
      if (!(e instanceof BaziError && e.code === 'E_DST_GAP')) throw e;
    }
  }
  throw new BaziError('E_DST_GAP', '该日期因夏令时调整无法确定当天起点');
}

/**
 * 三柱模式排盘（年、月、日柱 + 起运大运）。
 * @param solarDate 公历出生日期 'YYYY-MM-DD'（农历输入先经 CAL-INPUT 换算）
 * @param timezone IANA 时区（未选出生地为 Asia/Shanghai）
 * @param gender 性别（起运顺逆）
 * @param jieqiChoice 交节日用户选择；null 等同 'unsure'
 */
export function computeNoHour(
  solarDate: string,
  timezone: string,
  gender: Gender,
  jieqiChoice: JieqiChoice | null,
): NoHourResult {
  const noonUtcMs = clockToUtc(solarDate, NO_HOUR_DEFAULT_TIME, timezone).utcMs;
  const noonYm = computeYearMonth(noonUtcMs);
  const dayStart = localMidnightUtcMs(solarDate, timezone);
  const dayEnd = localMidnightUtcMs(nextDate(solarDate), timezone);

  // 当天的节：12:00 之前（含 12:00）交的是 jieqi_prev，之后交的是 jieqi_next
  let jie: { moment: JieqiMoment; utcMs: number } | null = null;
  if (noonYm.jieqiPrevUtcMs > dayStart) {
    jie = { moment: noonYm.jieqi_prev, utcMs: noonYm.jieqiPrevUtcMs };
  } else if (noonYm.jieqiNextUtcMs < dayEnd) {
    jie = { moment: noonYm.jieqi_next, utcMs: noonYm.jieqiNextUtcMs };
  }

  const day = dayPillarOf(...(solarDate.split('-').map(Number) as [number, number, number]));
  const rules_hit = ['CAL-NOHOUR'];

  let utcMs = noonUtcMs;
  let ym = noonYm;
  let side: NoHourResult['side'] = null;
  let uncertain: NoHourResult['uncertain'] = { month_pillar: null, jieqi_time: null };

  if (jie !== null) {
    const noonSide = noonUtcMs < jie.utcMs ? 'before' : 'after';
    if (jieqiChoice === 'before' || jieqiChoice === 'after') {
      side = jieqiChoice;
      if (side !== noonSide) {
        utcMs =
          side === 'before'
            ? dayStart + Math.floor((jie.utcMs - dayStart) / 2 / SECOND_MS) * SECOND_MS
            : jie.utcMs + Math.floor((dayEnd - jie.utcMs) / 2 / SECOND_MS) * SECOND_MS;
        ym = computeYearMonth(utcMs);
      }
    } else {
      side = noonSide;
      const before = computeYearMonth(jie.utcMs - SECOND_MS);
      const after = computeYearMonth(jie.utcMs);
      uncertain = {
        month_pillar: [
          [before.year, before.month],
          [after.year, after.month],
        ],
        jieqi_time: formatBeijing(jie.utcMs),
      };
    }
  }

  return {
    hourKnown: false,
    utcMs,
    ym,
    day,
    hour: null,
    jieqiOnBirthday: jie?.moment ?? null,
    side,
    uncertain,
    dayun: computeDayun(utcMs, gender, ym, { approximate: true }),
    rules_hit: ['CAL-TZ', ...ym.rules_hit, 'CAL-DH', ...rules_hit, 'CAL-YUN'],
  };
}
