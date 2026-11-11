/**
 * 素材 lint L1–L12（TASKS T24 / T25；rules/texts/README.md §7、report-sections.md §7）。
 *
 * 纯函数：输入已通过 schema 的条目与词表，输出问题清单（条目 id + 规则编号 + 原因）。读文件、打印由 scripts/texts-lint.ts 完成。
 * L1 的 YAML 子集 / schema 部分在 parseTextsYaml 中检查（不过即整文件拒绝），这里补 id 正则与槽位存在性。
 *
 * - L1 槽位存在于注册表，且不是代码模板槽位。
 * - L2 when / asserts 只引用字段字典中的字段；必需槽位的 when 只引用其维度 + 修饰字段；item.* 只用于循环槽位；
 *      运算符与字段类型匹配、取值在域内；深度 ≤ 3；{} 只允许兜底条目与固定文本槽位。
 * - L3 占位符只引用字段字典字段；`|名` 只用于十神组字段；item.* 占位符只用于循环槽位。
 * - L4 禁用词 / 疾病名词 / 金融产品词（变体与 quote 都查），子串匹配，白名单可豁免整段词语。
 * - L5 正文无 4 位数字；干支字面只出现在 asserts 锁定了该干支的条目中。
 * - L6 五行字与「喜 / 用 / 有利 / 忌 / 节制 / 不利」在 8 字窗口内共现时，该五行必须被 asserts 锁定。
 *   占位符整体替换为占位字符后再检查（占位符给出的五行由代码保证正确）。
 * - L7 正文出现「时柱 / 时干 / 时支 / 出生时辰」的条目必须 requires_hour: true。
 * - L8 每个变体字数在 length 区间内（汉字 + 标点，不计空白；占位符按典型长度计，见 placeholderLength）；
 *      变体 2–3 个（兜底条目、固定文本槽位 1–3 个）。另查 README §10：槽位不允许润色时 polish_allowed 不得为 true。
 * - L9 正文不含「依据：」；glossary 术语后不得紧跟全角括号「（」。
 * - L10 同槽位任两条素材的变体之间、同条目变体之间，字符 4-gram Jaccard ≤ 0.6（占位符视为一个符号）。
 * - L11 approved 条目：reviewer 非空；有 quote 时 verified = true 且 edition 非空。
 * - L12 绝对化用语（一定、必然、注定、肯定会）零命中；不出现「您」「命主」「大师」。
 */
import { slotDef } from '../report/slots';
import { conditionDepth, conditionFields, MAX_CONDITION_DEPTH } from './condition';
import { fieldSpec, GOD_GROUPS, PLACEHOLDER_FILTERS, type FieldSpec } from './fields';
import type { Condition, TextEntry } from './schema';
import { ENTRY_ID_RE, LEAF_OPS } from './schema';

export type LintRule =
  'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9' | 'L10' | 'L11' | 'L12';

export interface LintOptions {
  /** 术语加注表（glossary.yaml）的术语；未就绪时用 README §8 示例 */
  glossary: readonly string[];
}

export interface LintIssue {
  id: string;
  rule: LintRule;
  message: string;
}

export interface Wordlists {
  /** 禁用词（report-sections.md §7 + wordlists/forbidden.txt） */
  forbidden: readonly string[];
  /** 疾病名词；词表未就绪时为空 */
  disease: readonly string[];
  /** 金融产品词；词表未就绪时为空 */
  finance: readonly string[];
  /** 白名单：包含禁用词但允许出现的完整词语（如「灾」的误报），人工确认后加入 */
  whitelist: readonly string[];
}

/** 从 report-sections.md §7 解析「禁用词表」（词表文件未就绪时的回退来源，避免手抄漂移） */
export function parseForbiddenWordsFromMd(md: string): string[] {
  const m = /\*\*禁用词表[^*]*\*\*：([^\n]+)/.exec(md);
  if (!m) throw new Error('report-sections.md 中找不到「禁用词表」');
  return (m[1] as string)
    .replace(/。\s*$/, '')
    .split('、')
    .map((w) => w.trim())
    .filter(Boolean);
}

const PLACEHOLDER_RE = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;
const GANZHI_RE = /[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g;
const WUXING_CHARS = ['木', '火', '土', '金', '水'] as const;
/** L6 关键词（README §7） */
export const L6_KEYWORDS = ['有利', '节制', '不利', '喜', '用', '忌'] as const;
export const L6_WINDOW = 8;

function leaves(c: Condition): Record<string, unknown>[] {
  const n = c as unknown as Record<string, unknown>;
  if (Array.isArray(n.all)) return (n.all as Condition[]).flatMap(leaves);
  if (Array.isArray(n.any)) return (n.any as Condition[]).flatMap(leaves);
  if (n.not) return leaves(n.not as Condition);
  return typeof n.f === 'string' ? [n] : [];
}

/** asserts 锁定的事实：eq / in / contains 给出的取值，以及 power_pct.<五行> 断言涉及的五行 */
function lockedValues(entry: TextEntry): Set<string> {
  const out = new Set<string>();
  for (const a of entry.asserts) {
    for (const leaf of leaves(a)) {
      // 对某一五行的力量下断言（如 {f: power_pct.土, gte: 25}）即锁定该五行作为正文主语
      const pm = /^power_pct\.([木火土金水])$/.exec(leaf.f as string);
      if (pm) out.add(pm[1] as string);
      for (const op of ['eq', 'in', 'contains'] as const) {
        const v = leaf[op];
        if (typeof v === 'string') out.add(v);
        if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && out.add(x));
      }
    }
  }
  return out;
}

function checkLeafType(leaf: Record<string, unknown>, spec: FieldSpec): string | null {
  const op = Object.keys(leaf).find((k) => k !== 'f') as string;
  const v = leaf[op];
  if (op === 'exists') return null;
  const inDomain = (x: unknown, d: readonly string[]): boolean =>
    typeof x === 'string' && d.includes(x);
  switch (spec.kind) {
    case 'enum':
      if (!['eq', 'ne', 'in', 'not_in'].includes(op)) return `枚举字段不能用 ${op}`;
      for (const x of Array.isArray(v) ? v : [v])
        if (!inDomain(x, spec.domain)) return `取值 ${JSON.stringify(x)} 不在域内`;
      return null;
    case 'bool':
      if (op !== 'eq' && op !== 'ne') return `布尔字段只能用 eq / ne`;
      return typeof v === 'boolean' ? null : `布尔字段的取值必须是 true / false`;
    case 'int':
      if (!['eq', 'ne', 'gte', 'gt', 'lte', 'lt', 'in', 'not_in'].includes(op))
        return `整数字段不能用 ${op}`;
      for (const x of Array.isArray(v) ? v : [v])
        if (typeof x !== 'number') return `整数字段的取值必须是数`;
      return null;
    case 'list':
      if (op !== 'contains' && op !== 'not_contains')
        return `列表字段只能用 contains / not_contains`;
      return inDomain(v, spec.domain) ? null : `取值 ${JSON.stringify(v)} 不在域内`;
    case 'objectList':
      if (op !== 'contains' && op !== 'not_contains')
        return `对象列表只能用 contains / not_contains / exists`;
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? null
        : `对象列表的取值必须是对象`;
    case 'text':
      return `文本字段 ${leaf.f as string} 只能用于占位符，不能作条件`;
  }
}

/** 占位符替换为同长度占位字符，供 L4–L6 只检查作者手写的文字 */
function stripPlaceholders(s: string): string {
  return s.replace(PLACEHOLDER_RE, (m) => '□'.repeat(m.length));
}

export function lintEntries(
  entries: readonly TextEntry[],
  words: Wordlists,
  opts: LintOptions = { glossary: [] },
): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (id: string, rule: LintRule, message: string): void => {
    issues.push({ id, rule, message });
  };

  for (const e of entries) {
    // ---------- L1 ----------
    if (!ENTRY_ID_RE.test(e.id)) add(e.id, 'L1', 'id 不符合正则 ^CH\\d-[A-Z0-9-]+$');
    const slot = slotDef(e.slot);
    if (!slot) {
      add(e.id, 'L1', `槽位 ${e.slot} 不在 report-sections.md §3`);
    } else if (slot.source === 'code') {
      add(e.id, 'L1', `槽位 ${e.slot} 是代码模板，不走素材`);
    }

    // ---------- L2 ----------
    const conds: [string, Condition][] = [
      ['when', e.when],
      ...e.asserts.map((a, i): [string, Condition] => [`asserts[${i}]`, a]),
    ];
    const isEmptyWhen = Object.keys(e.when).length === 0;
    if (isEmptyWhen && !e.fallback && slot?.source !== 'fixed')
      add(e.id, 'L2', '空条件 {} 只允许兜底条目使用');
    if (e.fallback && !isEmptyWhen) add(e.id, 'L2', '兜底条目的 when 应为 {}');
    for (const [where, c] of conds) {
      let depth = 0;
      try {
        depth = conditionDepth(c);
      } catch (err) {
        add(e.id, 'L2', `${where}：${(err as Error).message}`);
        continue;
      }
      if (depth > MAX_CONDITION_DEPTH)
        add(e.id, 'L2', `${where}：嵌套深度 ${depth} 超过 ${MAX_CONDITION_DEPTH}`);
      for (const leaf of leaves(c)) {
        const f = leaf.f as string;
        const spec = fieldSpec(f);
        if (!spec) {
          add(e.id, 'L2', `${where}：字段 ${f} 不在字段字典（README §3）`);
          continue;
        }
        if (f.startsWith('item.') && slot && !slot.loop)
          add(e.id, 'L2', `${where}：非循环槽位不能引用 ${f}`);
        if (!(LEAF_OPS as readonly string[]).some((op) => op in leaf)) continue;
        const t = checkLeafType(leaf, spec);
        if (t) add(e.id, 'L2', `${where}：${f} ${t}`);
      }
    }
    if (slot?.required && slot.dimensionFields) {
      const allowed = new Set([...slot.dimensionFields, ...slot.modifierFields]);
      for (const f of conditionFields(e.when)) {
        if (!allowed.has(f))
          add(
            e.id,
            'L2',
            `when 引用了 ${f}；必需槽位 ${slot.id} 只允许 ${[...allowed].join('、')}`,
          );
      }
    }

    // ---------- L3 ----------
    for (const [vi, text] of e.variants.entries()) {
      for (const m of text.matchAll(PLACEHOLDER_RE)) {
        const path = (m[1] as string).trim();
        const filter = m[2];
        const spec = fieldSpec(path);
        if (!spec) {
          add(e.id, 'L3', `变体 ${vi + 1}：占位符 {${path}} 不在字段字典`);
          continue;
        }
        if (path.startsWith('item.') && slot && !slot.loop)
          add(e.id, 'L3', `变体 ${vi + 1}：非循环槽位不能用 {${path}}`);
        if (filter !== undefined) {
          const isGod =
            spec.kind === 'enum' &&
            spec.domain.every((d) => (GOD_GROUPS as readonly string[]).includes(d));
          if (!(PLACEHOLDER_FILTERS as readonly string[]).includes(filter)) {
            add(e.id, 'L3', `变体 ${vi + 1}：未知过滤器 |${filter}`);
          } else if (!isGod) {
            add(e.id, 'L3', `变体 ${vi + 1}：|名 只能用于十神组字段，{${path}} 不是`);
          }
        }
      }
      if (/[{}]/.test(text.replace(PLACEHOLDER_RE, '')))
        add(e.id, 'L3', `变体 ${vi + 1}：有不成对的花括号`);
    }

    // ---------- L4 ----------
    const texts: [string, string][] = [
      ...e.variants.map((v, i): [string, string] => [`变体 ${i + 1}`, v]),
      ...(e.quote ? [['quote', e.quote.text] as [string, string]] : []),
    ];
    for (const [where, raw] of texts) {
      let t = stripPlaceholders(raw);
      for (const w of words.whitelist) t = t.split(w).join('□'.repeat(w.length));
      for (const [kind, list] of [
        ['禁用词', words.forbidden],
        ['疾病名词', words.disease],
        ['金融产品词', words.finance],
      ] as const) {
        for (const w of list)
          if (w && t.includes(w)) add(e.id, 'L4', `${where}：命中${kind}「${w}」`);
      }
    }

    // ---------- L5 / L6（只查正文变体） ----------
    const locked = lockedValues(e);
    for (const [vi, raw] of e.variants.entries()) {
      const t = stripPlaceholders(raw);
      if (/\d{4}/.test(t))
        add(e.id, 'L5', `变体 ${vi + 1}：出现 4 位数字（年份只能用 item.*year* 占位符）`);
      for (const m of t.matchAll(GANZHI_RE)) {
        if (!locked.has(m[0]))
          add(e.id, 'L5', `变体 ${vi + 1}：干支字面「${m[0]}」未被 asserts 锁定`);
      }
      const reported = new Set<string>();
      for (let i = 0; i < t.length; i++) {
        const ch = t[i] as string;
        if (!(WUXING_CHARS as readonly string[]).includes(ch) || locked.has(ch) || reported.has(ch))
          continue;
        const lo = Math.max(0, i - L6_WINDOW);
        const window = t.slice(lo, i + L6_WINDOW + 1);
        const hit = L6_KEYWORDS.find((k) => window.includes(k));
        if (hit) {
          reported.add(ch);
          add(
            e.id,
            'L6',
            `变体 ${vi + 1}：五行「${ch}」与「${hit}」在 ${L6_WINDOW} 字内共现，需 asserts 锁定该五行或改用占位符（…${window}…）`,
          );
        }
      }
    }
  }
  issues.push(...lintL7toL12(entries, opts, words.whitelist));
  return issues;
}

// ---------------------------------------------------------------- L7–L12

export const HOUR_WORDS = ['时柱', '时干', '时支', '出生时辰'] as const;
/** 「时柱 / 时干 / 时支」前一个字是 当、及、同、准、按、临、随、适、平 时是普通词（当时支持、同时干、及时支付），不算 */
const HOUR_WORD_RE = /(?<![当及同准按临随适平])时[柱干支]|出生时辰/;
export const ABSOLUTE_WORDS = ['一定', '必然', '注定', '肯定会'] as const;
export const PERSON_WORDS = ['您', '命主', '大师'] as const;
export const JACCARD_MAX = 0.6;

/**
 * 占位符典型长度（README §3.3：干支 / 五行组合 2 字，百分比 3 字，十神 2 字，列表 4 字）。
 * 这里按单个占位符计：百分比数字 2 字（作者在其后手写的「%」另计 1 字，合起来 3 字）、年份 4 字、
 * 其他整数 2 字；枚举取域内字符串的平均长度四舍五入（五行 / 天干 1 字、十神 2 字、等级 2–4 字）；
 * |名 取十神组显示名长度（2 字）；列表 4 字；文本（干支）2 字。
 */
export function placeholderLength(path: string, filter?: string): number {
  const spec = fieldSpec(path);
  if (!spec) return 2;
  if (filter === '名') return 2;
  switch (spec.kind) {
    case 'int':
      return /year/.test(path) ? 4 : 2;
    case 'list':
    case 'objectList':
      return 4;
    case 'enum': {
      const total = spec.domain.reduce((s, d) => s + [...d].length, 0);
      return Math.max(1, Math.round(total / spec.domain.length));
    }
    case 'bool':
      return 1;
    case 'text':
      return 2;
  }
}

/** 变体字数：非空白字符数，占位符按典型长度替换 */
export function variantLength(text: string): number {
  let n = 0;
  const rest = text.replace(PLACEHOLDER_RE, (_m, p: string, f?: string) => {
    n += placeholderLength(p.trim(), f);
    return '';
  });
  return n + [...rest.replace(/\s/g, '')].length;
}

function grams4(text: string): Set<string> {
  const t = [...text.replace(PLACEHOLDER_RE, '◇').replace(/\s/g, '')];
  const out = new Set<string>();
  for (let i = 0; i + 4 <= t.length; i++) out.add(t.slice(i, i + 4).join(''));
  return out;
}

export function jaccard4(a: string, b: string): number {
  const A = grams4(a);
  const B = grams4(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function lintL7toL12(
  entries: readonly TextEntry[],
  opts: LintOptions,
  whitelist: readonly string[],
): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (id: string, rule: LintRule, message: string): void => {
    issues.push({ id, rule, message });
  };
  const terms = [...opts.glossary].sort((x, y) => y.length - x.length);

  for (const e of entries) {
    const slot = slotDef(e.slot);
    // L7
    if (!e.requires_hour) {
      for (const v of e.variants) {
        const m = HOUR_WORD_RE.exec(stripPlaceholders(v));
        if (m) {
          add(e.id, 'L7', `正文出现「${m[0]}」，需要 requires_hour: true`);
          break;
        }
      }
    }
    // L8
    const single = e.fallback || slot?.source === 'fixed';
    const [lo, hi] = e.length;
    if (!single && (e.variants.length < 2 || e.variants.length > 3)) {
      add(e.id, 'L8', `变体 ${e.variants.length} 个，应为 2–3 个`);
    }
    e.variants.forEach((v, i) => {
      const n = variantLength(v);
      if (n < lo || n > hi) add(e.id, 'L8', `变体 ${i + 1}：${n} 字，不在 [${lo}, ${hi}]`);
    });
    if (slot && !slot.polish && e.polish_allowed === true) {
      add(e.id, 'L8', `槽位 ${slot.id} 不允许润色，polish_allowed 不得为 true（README §10）`);
    }
    // L9
    e.variants.forEach((v, i) => {
      if (v.includes('依据：'))
        add(e.id, 'L9', `变体 ${i + 1}：正文不得写「依据：」（由槽位模板生成）`);
      for (const t of terms) {
        if (v.includes(`${t}（`)) {
          add(e.id, 'L9', `变体 ${i + 1}：术语「${t}」后紧跟全角括号，与自动加注冲突`);
          break;
        }
      }
    });
    // L11
    if (e.status === 'approved') {
      if (!e.reviewer) add(e.id, 'L11', 'approved 条目必须填写 reviewer');
      if (e.quote && !e.quote.verified)
        add(e.id, 'L11', 'approved 条目的 quote 必须 verified: true');
      if (e.quote && !e.quote.edition)
        add(e.id, 'L11', 'approved 条目的 quote 必须写明核对底本 edition');
    }
    // L12
    e.variants.forEach((v, i) => {
      let t = stripPlaceholders(v);
      // 白名单与 L4 共用：如「不一定」「一定的」不是绝对化断言
      for (const w of whitelist) t = t.split(w).join('□'.repeat(w.length));
      for (const w of ABSOLUTE_WORDS)
        if (t.includes(w)) add(e.id, 'L12', `变体 ${i + 1}：绝对化用语「${w}」`);
      for (const w of PERSON_WORDS)
        if (t.includes(w)) add(e.id, 'L12', `变体 ${i + 1}：人称用「你」，不用「${w}」`);
    });
    // L10：同条目变体之间
    for (let i = 0; i < e.variants.length; i++) {
      for (let j = i + 1; j < e.variants.length; j++) {
        const s = jaccard4(e.variants[i] as string, e.variants[j] as string);
        if (s > JACCARD_MAX)
          add(e.id, 'L10', `变体 ${i + 1} 与变体 ${j + 1} 相似度 ${s.toFixed(2)} > ${JACCARD_MAX}`);
      }
    }
  }

  // L10：同槽位条目之间（取两条目所有变体对的最大值）
  const bySlot = new Map<string, TextEntry[]>();
  for (const e of entries) bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
  for (const list of bySlot.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a] as TextEntry;
        const B = list[b] as TextEntry;
        let max = 0;
        for (const x of A.variants) for (const y of B.variants) max = Math.max(max, jaccard4(x, y));
        if (max > JACCARD_MAX)
          add(A.id, 'L10', `与同槽位 ${B.id} 的变体相似度 ${max.toFixed(2)} > ${JACCARD_MAX}`);
      }
    }
  }
  return issues;
}
