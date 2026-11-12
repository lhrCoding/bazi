/**
 * 大模型润色接口（TASKS T36；rules/report-sections.md §9 R-POLISH，ARCHITECTURE §4.3.10）。默认关闭，MVP 不实现调用。
 *
 * - Polisher 接口 + NoopPolisher（原样返回）。createPolisher({ enabled, impl })：enabled = false（默认）→ Noop；
 *   enabled = true 但没有真实实现 → 抛错（启动期，防止误开）。环境变量 REPORT_POLISH_ENABLED 由 apps/web 读取后传入
 *   （core 不读环境变量），parsePolishEnabled 负责解析。
 * - 送润色的段落：槽位润色 = 可、条目 polish_allowed ≠ false 的素材段落（ParaBlock.polishable）；古籍原文、代码模板段、
 *   表格、卡片结构字段、提示与免责声明一律不送；健康段 CH6-HEALTH 按 §9 不送（§3 表格写「可」，取更严的 §9）。
 * - 输入只有单段文本 + 锁定词（年份、干支、百分比、五行、十神、档位、吉神名、喜忌角色词），不传 ctx 与出生信息。
 * - 校验（validatePolish）：锁定词多重集合相等；不新增干支 / 年份 / 五行 / 十神；字数变化 ±15% 以内。不过 → 用原文。
 * - 超时：单段 3 秒、全报告 20 秒，超时用原文。
 * - 确定性与缓存（按 chart_key、条目 id、变体序号、素材库版本）在接入真实实现时由 apps/web 提供；Noop 下天然确定。
 */
import type { Block, ParaBlock, Report, YearCard } from './assemble';

// core 的 tsconfig 只带 ES 库；计时器在浏览器与 Node 中都存在，这里只声明用到的最小签名
declare function setTimeout(cb: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

export interface PolishSegment {
  text: string;
  lockedTerms: string[];
}

export interface Polisher {
  readonly name: string;
  polish(segment: PolishSegment): Promise<string>;
}

export const NoopPolisher: Polisher = {
  name: 'noop',
  polish: (s) => Promise.resolve(s.text),
};

export class PolishConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolishConfigError';
  }
}

/** REPORT_POLISH_ENABLED：未设置 / 空 / false → 关闭；true → 开启；其他值报错 */
export function parsePolishEnabled(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true' || v === '1') return true;
  throw new PolishConfigError(
    `REPORT_POLISH_ENABLED 只能是 true / false，收到 ${JSON.stringify(raw)}`,
  );
}

export function createPolisher(config: { enabled: boolean; impl?: Polisher }): Polisher {
  if (!config.enabled) return NoopPolisher;
  if (!config.impl || config.impl === NoopPolisher) {
    throw new PolishConfigError(
      'REPORT_POLISH_ENABLED=true 但没有润色实现（MVP 不提供），请关闭该开关',
    );
  }
  return config.impl;
}

/** §9：即使槽位允许，也一律不送润色的槽位 */
export const POLISH_EXCLUDED_SLOTS: readonly string[] = ['CH6-HEALTH'];
export const POLISH_SEGMENT_TIMEOUT_MS = 3000;
export const POLISH_REPORT_TIMEOUT_MS = 20000;
export const POLISH_LENGTH_TOLERANCE = 0.15;

const TEN_GODS = ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'];
const TIERS = ['宜保守、打基础', '顺势期', '向好', '平稳', '宜稳守'];
const JISHEN = ['天乙贵人', '月德贵人', '文昌贵人', '太极贵人'];
const ROLE_WORDS = ['用神', '喜神', '忌神', '闲神'];
const LOCK_RE = new RegExp(
  [
    '\\d{4}年',
    '\\d+%',
    '[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]',
    ...[...TIERS, ...JISHEN, ...TEN_GODS, ...ROLE_WORDS].map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ),
    '[木火土金水]',
  ].join('|'),
  'g',
);

/** 锁定词（按出现顺序，含重复） */
export function lockedTerms(text: string): string[] {
  return [...text.matchAll(LOCK_RE)].map((m) => m[0]);
}

const sortedJoin = (a: readonly string[]): string => [...a].sort().join('\u0000');

/** 返回 null 表示润色结果可用，否则返回拒绝原因 */
export function validatePolish(original: string, polished: string): string | null {
  const a = lockedTerms(original);
  const b = lockedTerms(polished);
  if (sortedJoin(a) !== sortedJoin(b)) {
    const extra = b.filter((x) => !a.includes(x));
    return extra.length > 0
      ? `新增了锁定词：${[...new Set(extra)].join('、')}`
      : '锁定词被删除或次数改变';
  }
  const n0 = [...original.replace(/\s/g, '')].length;
  const n1 = [...polished.replace(/\s/g, '')].length;
  if (n0 > 0 && Math.abs(n1 - n0) / n0 > POLISH_LENGTH_TOLERANCE)
    return `字数变化 ${n0} → ${n1} 超过 ±15%`;
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: unknown;
  return Promise.race([
    p,
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
const TIMEOUT = Symbol('timeout');

export interface PolishOutcome {
  report: Report;
  /** 送出的段落数 / 采用数 / 拒绝原因 */
  sent: number;
  accepted: number;
  rejected: { slot: string; entry: string | null; reason: string }[];
}

function paragraphsOf(b: Block): ParaBlock[] {
  if (b.type === 'para') return [b];
  if (b.type !== 'yearCard') return [];
  const c: YearCard = b;
  return [
    ...c.head,
    ...c.domains.career,
    ...c.domains.wealth,
    ...c.domains.love,
    ...c.domains.health,
    ...c.do,
    ...c.watch,
    ...c.rel,
  ];
}

/**
 * 对报告做润色。Noop（关闭）时不调用任何东西、原样返回同一对象。
 * 其余情况：深拷贝后逐段送润色，校验不过 / 超时 / 出错的段落保留原文。
 */
export async function polishReport(
  report: Report,
  polisher: Polisher,
  timeouts: { segmentMs?: number; reportMs?: number } = {},
): Promise<PolishOutcome> {
  if (polisher === NoopPolisher) return { report, sent: 0, accepted: 0, rejected: [] };
  const out = JSON.parse(JSON.stringify(report)) as Report; // 报告是纯 JSON 数据
  const segMs = timeouts.segmentMs ?? POLISH_SEGMENT_TIMEOUT_MS;
  const deadline = Date.now() + (timeouts.reportMs ?? POLISH_REPORT_TIMEOUT_MS);
  const result: PolishOutcome = { report: out, sent: 0, accepted: 0, rejected: [] };
  for (const ch of out.chapters) {
    for (const p of ch.blocks.flatMap(paragraphsOf)) {
      if (!p.polishable || POLISH_EXCLUDED_SLOTS.includes(p.slot)) continue;
      const left = deadline - Date.now();
      if (left <= 0) {
        result.rejected.push({ slot: p.slot, entry: p.entry, reason: '全报告润色超时' });
        continue;
      }
      result.sent++;
      let polished: string | typeof TIMEOUT;
      try {
        polished = await withTimeout(
          polisher.polish({ text: p.text, lockedTerms: lockedTerms(p.text) }),
          Math.min(segMs, left),
        );
      } catch (e) {
        result.rejected.push({
          slot: p.slot,
          entry: p.entry,
          reason: `润色出错：${(e as Error).message}`,
        });
        continue;
      }
      if (polished === TIMEOUT) {
        result.rejected.push({ slot: p.slot, entry: p.entry, reason: '单段润色超时' });
        continue;
      }
      const why = validatePolish(p.text, polished);
      if (why) {
        result.rejected.push({ slot: p.slot, entry: p.entry, reason: why });
        continue;
      }
      p.text = polished;
      result.accepted++;
    }
  }
  return result;
}
