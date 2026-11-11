/**
 * 素材 lint L1–L6（TASKS T24；rules/texts/README.md §7、report-sections.md §7）。
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
 */
import { slotDef } from '../report/slots';
import { conditionDepth, conditionFields, MAX_CONDITION_DEPTH } from './condition';
import { fieldSpec, GOD_GROUPS, PLACEHOLDER_FILTERS, type FieldSpec } from './fields';
import type { Condition, TextEntry } from './schema';
import { ENTRY_ID_RE, LEAF_OPS } from './schema';

export type LintRule = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

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

export function lintEntries(entries: readonly TextEntry[], words: Wordlists): LintIssue[] {
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
  return issues;
}
