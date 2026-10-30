/**
 * CAL-TZ：出生证上的本地钟表时间 → 绝对时刻（UTC）。rules/calendar.md §5。
 *
 * - 一律用 IANA 时区（Luxon 的 IANAZone，底层是运行环境的 Intl / tzdata），不手写 +8。
 *   中国大陆 1986–1991 年夏令时、1949 年以前的零星夏令时、海外时区都由 tzdata 提供；
 *   1988 年夏令时开始日以 tzdata 为准（04-17，而非部分资料的 04-10）。
 * - 夏令时结束日的重复时刻（如 01:00–01:59 出现两次）：取较晚的一次（标准时间，fold = 1），
 *   并置 dstAmbiguous = true，供结果页提示。
 * - 夏令时开始日不存在的时刻（如 02:00–02:59）：抛 BaziError('E_DST_GAP')，由表单提示「该时刻不存在，请核对」。
 * - 不使用 Luxon DateTime.fromObject 的默认消歧：它对不存在的时刻会静默顺延、对重复时刻的取舍不由我们控制。
 *   这里自己枚举候选偏移并逐一验证，结果确定。
 * - 错误信息不含任何输入值（ARCHITECTURE §4.1）。
 */
import { IANAZone } from 'luxon';
import { BaziError } from './errors';
import type { ClockToUtc } from './types';

/** 未选出生地时的默认时区（calendar.md §5）。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export interface ClockToUtcResult {
  /** 绝对时刻（Unix 毫秒） */
  utcMs: number;
  /** Chart.clock_to_utc 字段 */
  clock_to_utc: ClockToUtc;
  /** 命中的 CAL 规则编号 */
  rules_hit: string[];
}

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** 解析并校验 'YYYY-MM-DD' + 'HH:MM'，返回把钟表读数当作 UTC 的毫秒数。 */
function parseWallClock(date: string, time: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) {
    throw new BaziError('E_INVALID_DATETIME', '出生日期或时间格式不正确');
  }
  const [y, mo, d] = dm.slice(1).map(Number) as [number, number, number];
  const [h, mi] = tm.slice(1).map(Number) as [number, number];
  if (h > 23 || mi > 59) {
    throw new BaziError('E_INVALID_DATETIME', '出生时间不存在');
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(wall);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new BaziError('E_INVALID_DATETIME', '出生日期不存在');
  }
  return wall;
}

function formatUtc(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/**
 * 本地钟表时间 → UTC。
 * @param date 'YYYY-MM-DD'（公历）
 * @param time 'HH:MM'（出生证上的钟表时间）
 * @param timezone IANA 时区名，默认 Asia/Shanghai
 */
export function clockToUtc(
  date: string,
  time: string,
  timezone: string = DEFAULT_TIMEZONE,
): ClockToUtcResult {
  const zone = IANAZone.create(timezone);
  if (!zone.isValid) {
    throw new BaziError('E_INVALID_TIMEZONE', '时区无效');
  }
  const wall = parseWallClock(date, time);

  // 候选偏移：钟表读数前后各一天处的实际偏移（时区偏移变化间隔远大于两天，足以覆盖一次切换）。
  const offsets = new Set<number>();
  for (const probe of [wall - DAY_MS, wall, wall + DAY_MS]) offsets.add(zone.offset(probe));

  // 逐个验证：utc = 钟表 − 偏移，且该时刻的实际偏移恰好等于该偏移，才是钟表读数的一个合法解。
  const solutions = new Set<number>();
  for (const off of offsets) {
    const utc = wall - off * MIN_MS;
    if (zone.offset(utc) === off) solutions.add(utc);
  }
  if (solutions.size === 0) {
    throw new BaziError('E_DST_GAP', '该时刻因夏令时调整而不存在，请核对出生时间');
  }

  // 重复时刻取较晚一次（标准时间）
  const utcMs = Math.max(...solutions);
  return {
    utcMs,
    clock_to_utc: {
      utc: formatUtc(utcMs),
      timezone: zone.name,
      utcOffsetMinutes: zone.offset(utcMs),
      dstAmbiguous: solutions.size > 1,
    },
    rules_hit: ['CAL-TZ'],
  };
}
