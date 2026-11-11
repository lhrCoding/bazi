/**
 * 素材批次：抽样与 YAML 改写（TASKS T26；rules/texts/README.md §9、ARCHITECTURE §4.3.8）。
 *
 * 纯函数（字符串进、字符串出），读写文件由 scripts/texts-batch.ts 完成。
 *
 * - 抽样：样本量 = max(5, ⌈本批条目数 × 10%⌉)（不超过条目数）；种子 = `${批次号}-r${轮次}`；
 *   排序键 = FNV-1a 64（种子 + "|" + 条目 id），同键按 id 升序 → 同一种子结果永远相同。
 *   重抽（第 2 轮起）：上一轮不通过的条目必入样本；其余名额优先从「以往各轮都没抽过」的条目中按排序键取，不够再从抽过的里取。
 * - 改写：只按行替换目标条目块里的 `  status:` / `  reviewer:` 两行，其余字节（注释、流式写法、换行、引号）原样保留；
 *   改写后由调用方重新解析校验。
 */

export const SAMPLE_RATE = 0.1;
export const SAMPLE_MIN = 5;

export type RoundResult = 'pending' | 'pass' | 'fail';

export interface BatchRound {
  round: number;
  seed: string;
  date: string;
  result: RoundResult;
  sample: string[];
  /** 不通过的条目（result = fail 时） */
  failed: string[];
}

export function sampleSize(total: number): number {
  return Math.min(total, Math.max(SAMPLE_MIN, Math.ceil(total * SAMPLE_RATE)));
}

/** FNV-1a 64 位（逐个 UTF-16 码元按高、低字节输入），返回 16 位十六进制，供排序 */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    for (const b of [c >> 8, c & 0xff]) {
      h ^= BigInt(b);
      h = (h * prime) & 0xffffffffffffffffn;
    }
  }
  return h.toString(16).padStart(16, '0');
}

export function seedOf(batch: string, round: number): string {
  return `${batch}-r${round}`;
}

/**
 * 抽样。entryIds：本批全部条目；previous：之前各轮（按轮次升序）。
 */
export function drawSample(
  batch: string,
  entryIds: readonly string[],
  previous: readonly BatchRound[],
): { round: number; seed: string; sample: string[] } {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) throw new Error(`批次 ${batch} 没有条目`);
  const last = previous.at(-1);
  if (last && last.result === 'pending')
    throw new Error(`第 ${last.round} 轮尚未出结果（approve 或 reject 后才能重抽）`);
  if (last && last.result === 'pass') throw new Error(`第 ${last.round} 轮已通过，无需重抽`);
  const round = (last?.round ?? 0) + 1;
  const seed = seedOf(batch, round);
  const n = sampleSize(ids.length);
  const mustInclude = (last?.failed ?? []).filter((id) => ids.includes(id));
  const key = (id: string): string => fnv1a64(`${seed}|${id}`);
  const order = (a: string, b: string): number =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : 1;
  const sampledBefore = new Set(previous.flatMap((r) => r.sample));
  const fresh = ids.filter((id) => !mustInclude.includes(id) && !sampledBefore.has(id)).sort(order);
  const reused = ids.filter((id) => !mustInclude.includes(id) && sampledBefore.has(id)).sort(order);
  const sample = [...mustInclude, ...fresh, ...reused].slice(0, Math.max(n, mustInclude.length));
  return { round, seed, sample: sample.sort() };
}

const ENTRY_START = /^- id: (\S+)\s*$/;

/**
 * 把指定条目的 status / reviewer 两行替换掉。返回新文本与实际改到的 id。
 * reviewer 写成 YAML 双引号字符串（null 写 null）。
 */
export function setEntryStatus(
  source: string,
  ids: ReadonlySet<string>,
  status: 'draft' | 'reviewed' | 'approved',
  reviewer: string | null,
): { text: string; changed: string[] } {
  const lines = source.split('\n');
  const changed: string[] = [];
  let current: string | null = null;
  let sawStatus = false;
  let sawReviewer = false;
  const finish = (): void => {
    if (current !== null && ids.has(current)) {
      if (!sawStatus || !sawReviewer)
        throw new Error(`条目 ${current} 缺少顶层 status 或 reviewer 行`);
      changed.push(current);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = ENTRY_START.exec(line);
    if (m || /^\S/.test(line)) {
      // 新条目开始，或遇到顶层非条目内容（注释等）不结束当前条目：只有 `- id:` 才切换
      if (m) {
        finish();
        current = m[1] as string;
        sawStatus = false;
        sawReviewer = false;
      }
      continue;
    }
    if (current === null || !ids.has(current)) continue;
    if (/^ {2}status: /.test(line)) {
      lines[i] = `  status: ${status}${trailingComment(line)}`;
      sawStatus = true;
    } else if (/^ {2}reviewer: /.test(line)) {
      lines[i] =
        `  reviewer: ${reviewer === null ? 'null' : JSON.stringify(reviewer)}${trailingComment(line)}`;
      sawReviewer = true;
    }
  }
  finish();
  return { text: lines.join('\n'), changed };
}

/** 保留行尾注释（仅当值是不含引号的简单标量时才可能有） */
function trailingComment(line: string): string {
  const v = line.replace(/^ {2}[a-z_]+: /, '');
  if (v.startsWith('"') || v.startsWith("'")) return '';
  const i = v.indexOf(' #');
  return i >= 0 ? v.slice(i) : '';
}

// ---------------------------------------------------------------- batches.yaml

function batchBlock(lines: readonly string[], batch: string): [number, number] {
  const start = lines.findIndex(
    (l) => l === `- batch: ${batch}` || l.startsWith(`- batch: ${batch} `),
  );
  if (start < 0) throw new Error(`batches.yaml 中没有批次 ${batch}`);
  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith('- batch: ')) end++;
  return [start, end];
}

export function roundLine(r: BatchRound): string {
  const list = (a: readonly string[]): string => `[${a.join(', ')}]`;
  return (
    `    - {round: ${r.round}, seed: ${r.seed}, date: ${r.date}, result: ${r.result}, ` +
    `sample: ${list(r.sample)}, failed: ${list(r.failed)}}`
  );
}

/** 设置批次块内某个顶层键（两空格缩进）的标量值，保留行尾注释 */
export function setBatchField(source: string, batch: string, key: string, value: string): string {
  const lines = source.split('\n');
  const [s, e] = batchBlock(lines, batch);
  for (let i = s; i < e; i++) {
    const line = lines[i] as string;
    if (line.startsWith(`  ${key}: `)) {
      lines[i] = `  ${key}: ${value}${trailingComment(line)}`;
      return lines.join('\n');
    }
  }
  throw new Error(`批次 ${batch} 没有字段 ${key}`);
}

/** 追加一轮（rounds: [] 时改成块列表），或替换同轮次的行 */
export function upsertRound(source: string, batch: string, r: BatchRound): string {
  const lines = source.split('\n');
  const [s, e] = batchBlock(lines, batch);
  const idx = lines.findIndex((l, i) => i > s && i < e && /^ {2}rounds:/.test(l));
  if (idx < 0) throw new Error(`批次 ${batch} 没有 rounds 字段`);
  const head = lines[idx] as string;
  if (/^ {2}rounds: \[\]/.test(head)) {
    lines.splice(
      idx,
      1,
      `  rounds:${trailingComment(head.replace('rounds: []', 'rounds: x'))}`,
      roundLine(r),
    );
    return lines.join('\n');
  }
  let j = idx + 1;
  while (j < e && /^ {4}- \{round: /.test(lines[j] as string)) {
    if ((lines[j] as string).startsWith(`    - {round: ${r.round},`)) {
      lines[j] = roundLine(r);
      return lines.join('\n');
    }
    j++;
  }
  lines.splice(j, 0, roundLine(r));
  return lines.join('\n');
}
