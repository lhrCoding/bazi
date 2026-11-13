/**
 * 日志哨兵（TASKS T60；PRD P0-10、ARCHITECTURE §6.4）：用一组特征出生信息跑全流程后，在日志里搜它的各种写法。
 * Playwright 测试与单元测试共用（单元测试证明：日志里真有出生信息时一定能搜到）。
 */

/** 特征出生信息：1977-08-23 13:57、女、北京市海淀区（110108） */
export const SENTINEL = {
  date: '1977-08-23',
  time: '13:57',
  place: '110108',
  canonical: '{"v":1,"c":"s","d":"1977-08-23","lp":0,"t":"13:57","g":"f","p":"110108","j":null}',
} as const;

export const sentinelPayload = (canonical: string = SENTINEL.canonical): string =>
  Buffer.from(canonical, 'ascii').toString('base64url');

/** 需要搜索的全部写法：日期多种写法、时间、载荷全串及任意 16 字符子串、规范串 */
export function needles(
  s: { date: string; time: string; canonical: string } = SENTINEL,
  payload = sentinelPayload(s.canonical),
): string[] {
  const [y, m, d] = s.date.split('-') as [string, string, string];
  const out = new Set<string>([
    s.date,
    `${y}/${m}/${d}`,
    `${y}.${m}.${d}`,
    `${y}${m}${d}`,
    `${y}年${Number(m)}月${Number(d)}日`,
    `${y}年${m}月${d}日`,
    `${Number(m)}月${Number(d)}日`,
    `${m}-${d}`,
    s.time,
    s.time.replace(':', '时') + '分',
    payload,
    s.canonical,
    // 规范串在 JSON 日志里会被转义
    s.canonical.replace(/"/g, '\\"'),
  ]);
  for (let i = 0; i + 16 <= payload.length; i++) out.add(payload.slice(i, i + 16));
  return [...out];
}

export interface Leak {
  needle: string;
  line: string;
}

export function findLeaks(log: string, list: readonly string[] = needles()): Leak[] {
  const leaks: Leak[] = [];
  const lines = log.split('\n');
  for (const n of list) {
    const line = lines.find((l) => l.includes(n));
    if (line !== undefined) leaks.push({ needle: n, line: line.slice(0, 300) });
  }
  return leaks;
}
