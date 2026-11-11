/**
 * 槽位选段与变体确定性选择（TASKS T29；rules/texts/README.md §5.1、§5.2，ARCHITECTURE §4.3.4–4.3.5）。
 *
 * 选段（§5.1）：
 *   候选 = 该槽位非兜底条目
 *        → status ∈ 允许集合（生产 approved；开发 / 预览可配置）
 *        → when 与 asserts 成立（上下文 = ctx，循环槽位再加 item）
 *        → requires_hour 的条目在三柱时排除
 *        → 全部占位符可解析（字段为 null、不存在或空列表 → 不可选，而不是输出空白）
 *   排序 = priority 降序 → 特异度（when 叶子数）降序 → id 升序，取前 k 条。
 *   候选为空 → 用该槽位唯一的兜底条目，并记 fallback_used{slot} 事件（由 apps/web 记日志）。
 * 变体（§5.2）：idx = 大端 uint64(SHA-256(chart_key + "|" + entry_id + "|" + occurrence) 前 8 字节) mod 变体数。
 *   occurrence = 同一条目在本份报告中第几次被选中（从 0 开始）。按用户 2026-10-30 决定，再次命中只是用新的
 *   occurrence 重新取模，可能与上次相同，不做「顺延到下一个变体」。不含订单号、支付信息、生成时间。
 * 必需槽位（素材 / 固定文本）缺兜底 = 启动期错误：assertLibraryComplete 抛错，进程拒绝启动。
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { entryMatches, resolveField, specificity, type EvalContext } from '../texts/condition';
import type { TextEntry, TEXT_STATUSES } from '../texts/schema';
import { SLOTS, slotDef } from './slots';

export type TextStatus = (typeof TEXT_STATUSES)[number];

export const PLACEHOLDER_RE = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;

export class TextLibraryError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`素材库不完整：\n  ${problems.join('\n  ')}`);
    this.name = 'TextLibraryError';
  }
}

export interface TextLibrary {
  allowed: ReadonlySet<TextStatus>;
  /** 槽位 → 允许状态内的非兜底条目 */
  bySlot: ReadonlyMap<string, readonly TextEntry[]>;
  /** 槽位 → 兜底条目（允许状态内） */
  fallbacks: ReadonlyMap<string, TextEntry>;
}

/**
 * 建索引。同一槽位有多于 1 条兜底、或条目槽位不存在时抛错（任何环境都不允许）。
 * 必需槽位缺兜底不在这里抛（开发期素材未齐），由 assertLibraryComplete 在生产启动时检查。
 */
export function createLibrary(
  entries: readonly TextEntry[],
  allowed: readonly TextStatus[] = ['approved'],
): TextLibrary {
  const allow = new Set(allowed);
  const bySlot = new Map<string, TextEntry[]>();
  const fallbacks = new Map<string, TextEntry>();
  const problems: string[] = [];
  for (const e of entries) {
    if (!slotDef(e.slot)) problems.push(`${e.id}：槽位 ${e.slot} 不存在`);
    if (!allow.has(e.status)) continue;
    if (e.fallback) {
      const prev = fallbacks.get(e.slot);
      if (prev) problems.push(`${e.slot}：兜底条目多于 1 条（${prev.id}、${e.id}）`);
      fallbacks.set(e.slot, e);
    } else {
      bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
    }
  }
  if (problems.length > 0) throw new TextLibraryError(problems);
  return { allowed: allow, bySlot, fallbacks };
}

/**
 * 启动期检查：每个必需的素材槽位恰好有 1 条兜底；必需的固定文本槽位至少有 1 条 when 为 {} 的条目（或兜底）。
 */
export function libraryProblems(lib: TextLibrary): string[] {
  const problems: string[] = [];
  for (const s of SLOTS) {
    if (!s.required || s.source === 'code') continue;
    if (lib.fallbacks.has(s.id)) continue;
    if (
      s.source === 'fixed' &&
      (lib.bySlot.get(s.id) ?? []).some((e) => Object.keys(e.when).length === 0)
    )
      continue;
    problems.push(`${s.id}：必需槽位没有兜底条目`);
  }
  return problems;
}

export function assertLibraryComplete(lib: TextLibrary): void {
  const p = libraryProblems(lib);
  if (p.length > 0) throw new TextLibraryError(p);
}

/** 占位符引用的字段路径（去掉过滤器） */
export function placeholderPaths(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => (m[1] as string).trim());
}

/** 全部变体的全部占位符都能解析（非 null、存在、列表非空） */
export function placeholdersResolvable(entry: TextEntry, ctx: EvalContext): boolean {
  for (const v of entry.variants) {
    for (const p of placeholderPaths(v)) {
      const x = resolveField(ctx, p);
      if (x === null || x === undefined) return false;
      if (Array.isArray(x) && x.length === 0) return false;
    }
  }
  return true;
}

export interface SlotPick {
  slot: string;
  entries: TextEntry[];
  fallbackUsed: boolean;
}

/**
 * 对一个槽位选段。ctx 为 buildCtx 的输出（作为求值上下文），item 为循环槽位的当前项。
 * @param k 取前 k 条（由章节拼装按 report-sections.md「选几条」传入）
 */
export function selectSlot(
  lib: TextLibrary,
  slotId: string,
  ctx: EvalContext,
  k: number,
  item?: Readonly<Record<string, unknown>>,
): SlotPick {
  if (!slotDef(slotId)) throw new Error(`槽位 ${slotId} 不存在`);
  const evalCtx: EvalContext = item === undefined ? ctx : { ...ctx, item };
  const profile = (ctx.profile ?? {}) as { time_known?: boolean };
  const candidates = (lib.bySlot.get(slotId) ?? [])
    .filter((e) => entryMatches(e, evalCtx))
    .filter((e) => !e.requires_hour || profile.time_known === true)
    .filter((e) => placeholdersResolvable(e, evalCtx))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        specificity(b.when) - specificity(a.when) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  if (candidates.length > 0)
    return { slot: slotId, entries: candidates.slice(0, k), fallbackUsed: false };
  const fb = lib.fallbacks.get(slotId);
  if (fb && placeholdersResolvable(fb, evalCtx))
    return { slot: slotId, entries: [fb], fallbackUsed: true };
  return { slot: slotId, entries: [], fallbackUsed: fb !== undefined };
}

/** §5.2：大端 uint64(SHA-256(chart_key|entry_id|occurrence) 前 8 字节) mod n */
export function variantIndex(
  chartKey: string,
  entryId: string,
  occurrence: number,
  n: number,
): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('变体数必须是正整数');
  const h = sha256(utf8ToBytes(`${chartKey}|${entryId}|${occurrence}`));
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(h[i] as number);
  return Number(v % BigInt(n));
}

export interface ChosenText {
  entry: TextEntry;
  occurrence: number;
  variantIndex: number;
  text: string;
}

/** 一份报告内的变体选择器：记录每个条目已被选中的次数 */
export class VariantChooser {
  private readonly counts = new Map<string, number>();
  constructor(readonly chartKey: string) {}

  choose(entry: TextEntry): ChosenText {
    const occurrence = this.counts.get(entry.id) ?? 0;
    this.counts.set(entry.id, occurrence + 1);
    const idx = variantIndex(this.chartKey, entry.id, occurrence, entry.variants.length);
    return { entry, occurrence, variantIndex: idx, text: entry.variants[idx] as string };
  }
}

export interface FallbackUsedEvent {
  type: 'fallback_used';
  slot: string;
}
