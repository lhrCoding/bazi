/**
 * 测试专用：IANA 时区下的钟表时间 → 绝对时刻（Unix 毫秒），用 Node 内置 Intl（full-icu，含 1986–1991 夏令时）。
 *
 * 只供 T04 的 cases.json 对照使用（年柱、月柱需要绝对时刻）。正式的 CAL-TZ（Luxon、重复 / 不存在时刻处理、
 * 错误码）由 T05 在 src/ 中实现；T13 起对照测试改为调用 computeChart，本文件随之废弃。
 * 不处理重复 / 不存在时刻：遇到时直接抛错，避免测试静默用错时刻。
 */

function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const get = (t: string) =>
    Number(fmt.formatToParts(new Date(utcMs)).find((p) => p.type === t)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD HH:MM' 钟表时间 → Unix 毫秒 */
export function clockToUtcMsForTest(dateTime: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(dateTime);
  if (!m) throw new Error(`钟表时间格式应为 YYYY-MM-DD HH:MM：${dateTime}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const hits = new Set<number>();
  // 候选偏移取前后各一天的实际偏移，覆盖夏令时切换
  for (const probe of [wall - 86_400_000, wall, wall + 86_400_000]) {
    const utc = wall - offsetMinutesAt(probe, timeZone) * 60_000;
    if (utc + offsetMinutesAt(utc, timeZone) * 60_000 === wall) hits.add(utc);
  }
  if (hits.size !== 1) throw new Error(`钟表时间在 ${timeZone} 不存在或重复：${dateTime}`);
  return [...hits][0] as number;
}
