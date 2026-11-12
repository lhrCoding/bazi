/**
 * 静态覆盖率（TASKS T34；rules/report-sections.md §5.1 第 1、2 条，ARCHITECTURE §4.3.8）。
 *
 * 对每个必需素材槽位，按 COVERAGE_SPECS 穷举维度组合（修饰字段取默认值：borderline = false、time_known = true、
 * confidence = 高），检查每个组合至少有 1 条非兜底条目（状态在允许集合内）的 when 成立；另查每个必需素材槽位
 * 有且只有 1 条兜底。纯函数，读文件与打印由 scripts/texts-coverage.ts 完成。
 *
 * 只判 when：穷举时其他字段沿用基准 ctx，与改动后的维度不一定自洽（如改了日干但 el.* 未变），asserts 与占位符
 * 可解析性留给 T35 动态抽样（真实命盘、数据自洽）。requires_hour 条目在 time_known = true 默认下照常参与。
 *
 * 维度的穷举方式按 report-sections.md §3 逐槽位写明（不是简单笛卡尔积：如 CH1-BALANCE 的 special / paradox
 * 是普通组合之外的专用条目，二者互斥）。不可能出现的组合在 IMPOSSIBLE_COMBOS 中声明并写理由（需用户认可）。
 */
import type { EvalContext } from './condition';
import { evaluateCondition } from './condition';
import {
  FY_RULES,
  GOD_GROUPS,
  ROLES,
  SPECIALS,
  STRENGTH_LEVELS,
  TIERS,
  TIER_GROUPS,
  WUXING,
} from './fields';
import { TEN_GOD_NAMES } from '../bazi/ten-gods';
import { TIAN_GAN } from '../bazi/ganzhi';
import type { TextEntry, TEXT_STATUSES } from './schema';
import { SLOTS } from '../report/slots';

export type Combo = Readonly<Record<string, string | number | boolean | null>>;

/** 槽位 → 维度组合（每个组合是若干「字段路径 → 取值」） */
export type ComboSpec = () => Combo[];

const cross = (...lists: Combo[][]): Combo[] =>
  lists.reduce<Combo[]>((acc, l) => acc.flatMap((a) => l.map((b) => ({ ...a, ...b }))), [{}]);
const each = (f: string, vals: readonly (string | number | boolean | null)[]): Combo[] =>
  vals.map((v) => ({ [f]: v }));
const directionOf = (level: string): '偏弱' | '偏旺' =>
  ['身弱', '中和偏弱', '从弱'].includes(level) ? '偏弱' : '偏旺';
const SPECIAL_DIRECTION: Readonly<Record<string, '偏弱' | '偏旺'>> = {
  从财: '偏弱',
  从杀: '偏弱',
  从儿: '偏弱',
  从势: '偏弱',
  专旺: '偏旺',
  从强: '偏旺',
};
const FUYI = FY_RULES.filter((r) => r.startsWith('Y-FY-'));

/** 修饰字段默认值（README §4.4） */
export const MODIFIER_DEFAULTS: Combo = {
  'strength.borderline': false,
  'profile.time_known': true,
  'profile.confidence': '高',
};

export const COVERAGE_SPECS: Readonly<Record<string, ComboSpec>> = {
  'CH1-DAYMASTER': () => each('day.stem', TIAN_GAN),
  'CH1-MONTH': () => cross(each('day.element', WUXING), each('month.main_god', GOD_GROUPS)),
  'CH1-BALANCE': () => [
    ...cross(
      each('strength.direction', ['偏弱', '偏旺']),
      each('gods.top_yidang', ['食伤', '财', '官杀']),
    ).map((c) => ({ ...c, 'strength.special': null, 'strength.paradox': null })),
    ...SPECIALS.map((s) => ({
      'strength.special': s,
      'strength.direction': SPECIAL_DIRECTION[s] as string,
      'strength.paradox': null,
    })),
    { 'strength.paradox': '得令却身弱', 'strength.direction': '偏弱', 'strength.special': null },
    { 'strength.paradox': '失令却身旺', 'strength.direction': '偏旺', 'strength.special': null },
  ],
  'CH1-CONCLUSION': () =>
    STRENGTH_LEVELS.map((l) => ({ 'strength.level': l, 'strength.direction': directionOf(l) })),
  'CH2-METHOD': () => [
    ...FUYI.map((r) => ({ 'yongshen.fy_rule': r, 'strength.special': null })),
    ...SPECIALS.map((s) => ({
      'strength.special': s,
      'yongshen.fy_rule': SPECIAL_DIRECTION[s] === '偏弱' ? 'Y-CONG' : 'Y-ZHUANWANG',
    })),
  ],
  'CH2-ROLE-YONG': () => each('yongshen.yong_god', GOD_GROUPS),
  'CH2-ROLE-XI': () => each('yongshen.xi1_god', GOD_GROUPS),
  'CH2-ROLE-JI': () => each('yongshen.ji1_god', GOD_GROUPS),
  'CH3-BASE': () => each('day.stem', TIAN_GAN),
  'CH3-GOD': () =>
    cross(each('item.ten_god', TEN_GOD_NAMES), each('item.is_favorable', [true, false])),
  'CH3-STYLE': () =>
    STRENGTH_LEVELS.map((l) => ({ 'strength.level': l, 'strength.direction': directionOf(l) })),
  'CH3-TALENT': () =>
    cross(each('gods.top', GOD_GROUPS), each('strength.direction', ['偏弱', '偏旺'])),
  'CH4-WHY': () =>
    cross(each('yongshen.yong', WUXING), each('yongshen.xi1', WUXING)).filter(
      (c) => c['yongshen.yong'] !== c['yongshen.xi1'],
    ),
  'CH4-ELEMENT': () => cross(each('item.element', WUXING), each('item.role', ['用', '喜'])),
  'CH5-INTRO': () => each('profile.time_known', [true, false]),
  'CH5-STEP': () => cross(each('item.stem_ten_god', TEN_GOD_NAMES), each('item.tier', TIERS)),
  'CH5-FAR': () => each('dayun_summary.far_group', TIER_GROUPS),
  'CH6-HEAD': () => cross(each('item.stem_ten_god', TEN_GOD_NAMES), each('item.tier', TIERS)),
  ...Object.fromEntries(
    ['CH6-CAREER', 'CH6-WEALTH', 'CH6-LOVE', 'CH6-HEALTH', 'CH6-DO', 'CH6-WATCH'].map((s) => [
      s,
      () => cross(each('item.stem_god', GOD_GROUPS), each('item.tier_group', TIER_GROUPS)),
    ]),
  ),
  'CH7-CAREER': () =>
    cross(each('career.mode', GOD_GROUPS), each('strength.direction', ['偏弱', '偏旺'])),
  'CH7-WEALTH': () => cross(each('wealth.role', ROLES), each('wealth.level', ['强', '中', '弱'])),
  'CH7-LOVE': () => cross(each('partner.role', ROLES), each('profile.gender', ['男', '女'])),
  'CH7-HEALTH': () => {
    const base = Object.fromEntries(WUXING.map((w) => [`power_pct.${w}`, 20]));
    return [
      ...WUXING.flatMap((w) => [
        { ...base, [`power_pct.${w}`]: 45 },
        { ...base, [`power_pct.${w}`]: 3 },
      ]),
      base, // 均衡
    ];
  },
};

/** 不可能出现的组合：{槽位, 组合（部分字段即可匹配）, 理由}。新增须写理由并经用户认可。 */
export interface ImpossibleCombo {
  slot: string;
  combo: Combo;
  reason: string;
}
export const IMPOSSIBLE_COMBOS: readonly ImpossibleCombo[] = [];

export interface CoverageGap {
  slot: string;
  combo: Combo;
}

export interface CoverageResult {
  /** 每个槽位的组合数 / 已覆盖数 */
  slots: { slot: string; chapter: number; combos: number; covered: number }[];
  gaps: CoverageGap[];
  /** 兜底问题：缺兜底或多于 1 条 */
  fallbackProblems: string[];
  /** 必需素材槽位但没有 COVERAGE_SPECS（注册表新增槽位后需补）——测试会把它当错误 */
  unspecified: string[];
}

function setPath(o: Record<string, unknown>, path: string, v: unknown): void {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    cur[k] =
      typeof next === 'object' && next !== null && !Array.isArray(next)
        ? { ...(next as object) }
        : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys.at(-1) as string] = v;
}

/** 把组合写进基准 ctx（item.* 写到 ctx.item） */
export function applyCombo(base: EvalContext, combo: Combo): EvalContext {
  const o: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries({ ...MODIFIER_DEFAULTS, ...combo })) setPath(o, k, v);
  return o;
}

const matchesCombo = (c: Combo, part: Combo): boolean =>
  Object.entries(part).every(([k, v]) => c[k] === v);

export function computeCoverage(
  entries: readonly TextEntry[],
  base: EvalContext,
  allowed: readonly (typeof TEXT_STATUSES)[number][],
  impossible: readonly ImpossibleCombo[] = IMPOSSIBLE_COMBOS,
): CoverageResult {
  const allow = new Set(allowed);
  const result: CoverageResult = { slots: [], gaps: [], fallbackProblems: [], unspecified: [] };
  for (const s of SLOTS) {
    if (!s.required || s.source === 'code') continue;
    const inSlot = entries.filter((e) => e.slot === s.id);
    if (s.source === 'fixed') {
      if (!inSlot.some((e) => allow.has(e.status)))
        result.fallbackProblems.push(`${s.id}：固定文本槽位没有条目`);
      continue;
    }
    const fbs = inSlot.filter((e) => e.fallback);
    if (fbs.length !== 1)
      result.fallbackProblems.push(`${s.id}：兜底条目 ${fbs.length} 条（应为 1 条）`);
    const spec = COVERAGE_SPECS[s.id];
    if (!spec) {
      result.unspecified.push(s.id);
      continue;
    }
    const candidates = inSlot.filter((e) => !e.fallback && allow.has(e.status));
    const combos = spec().filter(
      (c) => !impossible.some((x) => x.slot === s.id && matchesCombo(c, x.combo)),
    );
    let covered = 0;
    for (const combo of combos) {
      const ctx = applyCombo(base, combo);
      if (candidates.some((e) => evaluateCondition(e.when, ctx))) covered++;
      else result.gaps.push({ slot: s.id, combo });
    }
    result.slots.push({ slot: s.id, chapter: s.chapter, combos: combos.length, covered });
  }
  return result;
}

/** 强制范围：batches.yaml 中 status = approved 的批次 scope（如 [CH1, CH2, CH6]）→ 章号 */
export function enforcedChapters(
  batches: readonly { status?: unknown; scope?: unknown }[],
): number[] {
  const out = new Set<number>();
  for (const b of batches) {
    if (b.status !== 'approved' || !Array.isArray(b.scope)) continue;
    for (const s of b.scope) {
      const m = /^CH(\d)$/.exec(String(s));
      if (m) out.add(Number(m[1]));
    }
  }
  return [...out].sort();
}

/** 落在强制章节里的缺口 / 兜底问题（= 失败） */
export function enforcedFailures(r: CoverageResult, chapters: readonly number[]): string[] {
  const chOf = (slot: string): number => Number(/^CH(\d)/.exec(slot)?.[1] ?? -1);
  return [
    ...r.gaps
      .filter((g) => chapters.includes(chOf(g.slot)))
      .map((g) => `${g.slot} ${JSON.stringify(g.combo)}`),
    ...r.fallbackProblems.filter((p) => chapters.includes(chOf(p))),
    ...r.unspecified.map((s) => `${s}：没有覆盖率穷举定义`),
  ];
}
