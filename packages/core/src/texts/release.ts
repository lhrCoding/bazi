/**
 * 素材发布快照与比对（TASKS T38；rules/texts/README.md §5.2、§9.3，ARCHITECTURE §4.3.8）。
 *
 * 快照 = apps/web/texts-releases/v{N}.json：{ format, textsVersion, rulesVersion, releasedAt, entries（只含 approved） }。
 * 发布规则：
 * - 只收 approved 条目；lint、静态覆盖率、动态抽样的问题由脚本算好传入，任一非空即拒绝。
 * - 与上一快照比对（approved 条目只允许追加变体，§5.2）：上一版的每个条目，
 *   · 仍在新版中：slot / when / asserts / requires_hour / fallback / priority 不变，且新变体列表以旧变体列表为前缀；
 *   · 不在新版中：源文件里必须标为 retired（退役，不得直接删除）。
 * 纯函数，读写文件由 scripts/texts-release.ts 完成。
 */
import { TextEntrySchema, type TextEntry } from './schema';
import { z } from 'zod';

export const SNAPSHOT_FORMAT = 1;

export const SnapshotSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  textsVersion: z.int().positive(),
  rulesVersion: z.string().min(1),
  releasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(TextEntrySchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export interface ReleaseChecks {
  lint: readonly string[];
  staticCoverage: readonly string[];
  dynamic: readonly string[];
}

/** 上一快照 → 新条目集合的兼容性问题（只许追加变体、不得删除已批准条目） */
export function compareWithPrevious(prev: Snapshot, source: readonly TextEntry[]): string[] {
  const problems: string[] = [];
  const byId = new Map(source.map((e) => [e.id, e]));
  const KEYS = ['slot', 'when', 'asserts', 'requires_hour', 'fallback', 'priority'] as const;
  for (const old of prev.entries) {
    const cur = byId.get(old.id);
    if (!cur) {
      problems.push(
        `${old.id}：v${prev.textsVersion} 中已批准的条目被删除（应改为 status: retired 并新建 id）`,
      );
      continue;
    }
    if (cur.status === 'retired') continue;
    if (cur.status !== 'approved') {
      problems.push(
        `${old.id}：v${prev.textsVersion} 中已批准，现状态为 ${cur.status}（修改正文须退役后新建）`,
      );
      continue;
    }
    for (const k of KEYS) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(old[k]))
        problems.push(`${old.id}：已批准条目的 ${k} 被修改`);
    }
    const prefixOk =
      cur.variants.length >= old.variants.length &&
      old.variants.every((v, i) => cur.variants[i] === v);
    if (!prefixOk)
      problems.push(`${old.id}：已批准条目的变体被删除、修改或调整顺序（只允许在末尾追加）`);
  }
  return problems;
}

export interface ReleaseResult {
  snapshot: Snapshot | null;
  problems: string[];
}

export function buildRelease(
  source: readonly TextEntry[],
  prev: Snapshot | null,
  meta: { rulesVersion: string; releasedAt: string },
  checks: ReleaseChecks,
): ReleaseResult {
  const problems = [
    ...checks.lint.map((x) => `lint：${x}`),
    ...checks.staticCoverage.map((x) => `静态覆盖率：${x}`),
    ...checks.dynamic.map((x) => `动态抽样：${x}`),
    ...(prev ? compareWithPrevious(prev, source) : []),
  ];
  const entries = source.filter((e) => e.status === 'approved');
  if (entries.length === 0) problems.push('没有 approved 条目，无可发布内容');
  if (problems.length > 0) return { snapshot: null, problems };
  return {
    snapshot: {
      format: SNAPSHOT_FORMAT,
      textsVersion: (prev?.textsVersion ?? 0) + 1,
      rulesVersion: meta.rulesVersion,
      releasedAt: meta.releasedAt,
      entries: [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    },
    problems: [],
  };
}
