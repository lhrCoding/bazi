/**
 * 北京标准时间（UTC+8，无夏令时）与绝对时刻（Unix 毫秒）互换。
 *
 * 为什么这里可以写固定的 +8：
 * - 「北京标准时间」按定义就是 UTC+8 的标准时，不含夏令时；它不是「中国大陆钟表时间」。
 * - 节气时刻（寿星天文历 / tyme4ts）以北京标准时间给出，年柱、月柱用绝对时刻与之比较（CAL-YM-2）。
 * - 「出生证上的钟表时间 → UTC」必须走 IANA 时区库（含 1986–1991 夏令时），那是 CAL-TZ（T05）的职责，
 *   不得用本文件代替。
 */

/** 北京标准时间相对 UTC 的偏移（毫秒）。 */
export const BEIJING_STANDARD_OFFSET_MS = 8 * 3600 * 1000;

export interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 绝对时刻 → 北京标准时间各字段（秒以下截断）。 */
export function toBeijingParts(utcMs: number): DateTimeParts {
  const d = new Date(Math.floor(utcMs / 1000) * 1000 + BEIJING_STANDARD_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** 北京标准时间各字段 → 绝对时刻（公历按前推格里历计算，适用于 1900 年以后）。 */
export function fromBeijingParts(p: DateTimeParts): number {
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - BEIJING_STANDARD_OFFSET_MS
  );
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 绝对时刻 → 'YYYY-MM-DD HH:MM:SS'（北京标准时间）。 */
export function formatBeijing(utcMs: number): string {
  const p = toBeijingParts(utcMs);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}
