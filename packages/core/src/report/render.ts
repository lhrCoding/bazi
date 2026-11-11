/**
 * 占位符替换、术语首次加注、依据（TASKS T30；rules/texts/README.md §3.3、§5.3、§8，report-sections.md §3）。
 *
 * - 占位符 `{字段路径}` / `{字段路径|名}`：列表用「、」连接；整数原样输出（百分比在 ctx 已取整，% 由作者手写）；
 *   `|名` 把十神组数据名显示为读者名（印 → 印星、财 → 财星）。无法解析（null、不存在、空列表、对象）抛错——
 *   选段阶段（select.ts placeholdersResolvable）已把这类条目排除，渲染时再遇到即为引擎缺陷。
 * - 术语加注（Annotator）：整份报告共用一个实例；按 glossary 最长优先匹配；每个术语只在**首次可加注的出现处**
 *   追加「（释义）」；引号（“”「」『』"）与括号（（）()）内不加注；表格、卡片标题、古籍原文由调用方不送入（annotatable = false）。
 * - 依据（basisFor）：report-sections.md §3「依据模板」的简写占位符（{S_pct}、{五行}、{x}…）不是字段路径，
 *   这里按槽位逐个用代码生成，措辞照模板，数值全部取自 ctx / item（第 5 章起运取 ctx.qiyun，T32）。
 *   第 6 章表格无依据列；模板为「—」的槽位返回 null。
 */
import type { EvalContext } from '../texts/condition';
import { resolveField } from '../texts/condition';
import { GOD_DISPLAY_NAME } from '../texts/fields';
import { PLACEHOLDER_RE } from './select';

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

function formatValue(path: string, v: unknown, filter: string | undefined): string {
  if (v === null || v === undefined) throw new RenderError(`占位符 {${path}} 无值`);
  if (Array.isArray(v)) {
    if (v.length === 0 || !v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      throw new RenderError(`占位符 {${path}} 不是非空标量列表`);
    }
    return v.map((x) => (filter === '名' ? displayGod(String(x)) : String(x))).join('、');
  }
  if (typeof v === 'string') return filter === '名' ? displayGod(v) : v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new RenderError(`占位符 {${path}} 不是整数：${v}`);
    return String(v);
  }
  throw new RenderError(`占位符 {${path}} 的值不能直接输出：${JSON.stringify(v)}`);
}

function displayGod(g: string): string {
  const d = (GOD_DISPLAY_NAME as Record<string, string>)[g];
  if (d === undefined) throw new RenderError(`|名 只能用于十神组，收到 ${g}`);
  return d;
}

/** 替换文本中的全部占位符（ctx 为求值上下文，循环槽位传 item） */
export function renderText(
  text: string,
  ctx: EvalContext,
  item?: Readonly<Record<string, unknown>>,
): string {
  const c: EvalContext = item === undefined ? ctx : { ...ctx, item };
  return text.replace(PLACEHOLDER_RE, (_m, p: string, f: string | undefined) => {
    const path = p.trim();
    if (f !== undefined && f !== '名') throw new RenderError(`未知过滤器 |${f}`);
    return formatValue(path, resolveField(c, path), f);
  });
}

// ---------------------------------------------------------------- 术语加注

export interface GlossaryTerm {
  term: string;
  note: string;
}

const OPEN = '“「『"（(';
const CLOSE: Readonly<Record<string, string>> = {
  '“': '”',
  '「': '」',
  '『': '』',
  '"': '"',
  '（': '）',
  '(': ')',
};

/** 文本中处于引号 / 括号内的位置 */
function protectedMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const top = stack.at(-1);
    if (top !== undefined && ch === CLOSE[top]) {
      mask[i] = true;
      stack.pop();
      continue;
    }
    if (OPEN.includes(ch) && !(ch === '"' && top === '"')) {
      stack.push(ch);
      mask[i] = true;
      continue;
    }
    mask[i] = stack.length > 0;
  }
  return mask;
}

/** 整份报告共用：记录已加注的术语 */
export class Annotator {
  private readonly terms: GlossaryTerm[];
  private readonly done = new Set<string>();

  constructor(glossary: readonly GlossaryTerm[]) {
    this.terms = [...glossary].sort(
      (a, b) => b.term.length - a.term.length || (a.term < b.term ? -1 : 1),
    );
  }

  get annotated(): ReadonlySet<string> {
    return this.done;
  }

  /** 对一段正文加注；annotatable = false（表格、卡片标题、古籍原文）时原样返回且不消耗「首次」 */
  annotate(text: string, annotatable = true): string {
    if (!annotatable) return text;
    const mask = protectedMask(text);
    let out = '';
    let i = 0;
    while (i < text.length) {
      const t = mask[i] ? undefined : this.terms.find((g) => text.startsWith(g.term, i));
      if (t) {
        out += t.term;
        i += t.term.length;
        if (!this.done.has(t.term)) {
          this.done.add(t.term);
          out += `（${t.note}）`;
        }
        continue;
      }
      out += text[i];
      i++;
    }
    return out;
  }
}

// ---------------------------------------------------------------- 依据

type C = Readonly<Record<string, Record<string, unknown>>>;
const G = (g: unknown): string => displayGod(String(g));

/**
 * 槽位依据「依据：」之后的文字；null = 该槽位不追加依据。
 * @param item 循环槽位的当前项（CH3-GOD：{ten_god, god, pos}；CH4-ELEMENT 等）
 */
export function basisFor(
  slot: string,
  ctx: EvalContext,
  item?: Readonly<Record<string, unknown>>,
): string | null {
  const c = ctx as unknown as C;
  const day = c.day ?? {};
  const st = c.strength ?? {};
  const gods = c.gods ?? {};
  const ys = c.yongshen ?? {};
  const month = c.month ?? {};
  const el = c.el ?? {};
  const pp = c.power_pct ?? {};
  const pctOfGod = (g: unknown): unknown => gods[`${String(g)}_pct`];
  switch (slot) {
    case 'CH1-DAYMASTER':
      return `日主${day.stem}${day.element}`;
    case 'CH1-MONTH':
      return `生于${month.branch}月，月令本气${month.main_qi}为${G(month.main_god)}`;
    case 'CH1-BALANCE':
      return `同党 ${st.S_pct}%（比劫 ${gods['比劫_pct']}%、印星 ${gods['印_pct']}%）；异党最强 ${G(gods.top_yidang)}`;
    case 'CH1-CONCLUSION':
      return `规则 S-LEVEL：${st.level}`;
    case 'CH2-METHOD':
      return `规则 ${ys.fy_rule}`;
    case 'CH2-SWAP':
      return '规则 Y-SWAP';
    case 'CH2-TIAOHOU':
      return `规则 Y-TH-${ys.th}`;
    case 'CH2-TONGGUAN':
      return '规则 Y-TG';
    case 'CH2-ROLE-YONG':
    case 'CH2-ROLE-XI':
    case 'CH2-ROLE-JI': {
      const key = slot === 'CH2-ROLE-YONG' ? 'yong' : slot === 'CH2-ROLE-XI' ? 'xi1' : 'ji1';
      const g = ys[`${key}_god`];
      return `${ys[key]}是你的${G(g)}，占 ${pctOfGod(g)}%`;
    }
    case 'CH2-NOHOUR-CONG': {
      const hours = (st.nohour_cong_hours as string[] | undefined) ?? [];
      return `若生于${hours.map((h) => `${h}时`).join('、')}可能符合从格条件`;
    }
    case 'CH3-PERSONA-LINE': {
      const persona = ((c.ten_gods ?? {}).persona as string[] | undefined) ?? [];
      return `日干${day.stem}、${persona.join('、')}`;
    }
    case 'CH3-BASE':
      return `日主${day.stem}`;
    case 'CH3-GOD': {
      if (!item) throw new RenderError('CH3-GOD 依据需要 item');
      return `${String(item.pos ?? '')}${item.ten_god}，${G(item.god)}占 ${pctOfGod(item.god)}%`;
    }
    case 'CH3-STYLE':
      return `同党 ${st.S_pct}%`;
    case 'CH3-TALENT':
      return `最强十神组 ${G(gods.top)} ${pctOfGod(gods.top)}%`;
    case 'CH3-SHENSHA': {
      if (!item) throw new RenderError('CH3-SHENSHA 依据需要 item（吉神名与位置）');
      return `吉神 ${item.name}（${String(item.positions)}）`;
    }
    case 'CH4-WHY':
      return `用神 ${ys.yong}、喜神 ${ys.xi1}`;
    case 'CH5-INTRO': {
      const q = (
        c as unknown as { qiyun?: { age: number; direction: string; approximate: boolean } }
      ).qiyun;
      return q ? `起运${q.approximate ? '约 ' : ' '}${q.age} 岁，${q.direction}排` : null;
    }
    case 'CH5-PAST':
    case 'CH5-FAR': {
      const phase = slot === 'CH5-PAST' ? 'past' : 'far';
      const steps = ((c as unknown as { dayun?: Record<string, unknown>[] }).dayun ?? []).filter(
        (d) => d.phase === phase,
      );
      return steps.length ? steps.map((d) => `${d.ganzhi}（${d.tier}）`).join('、') : null;
    }
    case 'CH5-STEP': {
      if (!item) throw new RenderError('CH5-STEP 依据需要 item（大运）');
      return `${item.ganzhi}（${item.start_year}–${item.end_year}）天干${item.stem_ten_god}，${item.tier}`;
    }
    case 'CH5-REL': {
      if (!item) throw new RenderError('CH5-REL 依据需要 item（大运）');
      const rels = (item.relations as { type: string; b: string }[] | undefined) ?? [];
      return `${item.ganzhi}${rels.map((r) => `${r.type}${r.b}`).join('、')}`;
    }
    case 'CH5-TRANSITION': {
      if (!item) throw new RenderError('CH5-TRANSITION 依据需要 item（换运年）');
      return `换运年 ${item.year}`;
    }
    case 'CH7-CAREER': {
      const mode = (c.career ?? {}).mode;
      const roleOfMode = ys.yong === el[String(mode)] ? '用神' : '喜神';
      const cur = ((c as unknown as { dayun?: Record<string, unknown>[] }).dayun ?? []).find(
        (d) => d.phase === 'current',
      );
      const tail = cur ? `；当前大运天干${cur.stem_ten_god}` : '';
      return `${G(mode)}为${roleOfMode}，占 ${pctOfGod(mode)}%${tail}`;
    }
    case 'CH7-CAREER-NOW': {
      const cur = ((c as unknown as { dayun?: Record<string, unknown>[] }).dayun ?? []).find(
        (d) => d.phase === 'current',
      );
      return cur ? `当前大运 ${cur.ganzhi}` : null;
    }
    case 'CH7-WEALTH':
      return `财星 ${gods['财_pct']}%，为${roleName((c.wealth ?? {}).role)}`;
    case 'CH7-LOVE': {
      const p = c.partner ?? {};
      return `伴侣星 ${p.pct}%，为${roleName(p.role)}；日支${(c.ten_gods ?? {}).day_branch}`;
    }
    case 'CH7-LOVE-YEARS': {
      const ln =
        (c as unknown as { liunian?: { year: number; relations: { type: string; b: string }[] }[] })
          .liunian ?? [];
      const hits = ln.flatMap((l) =>
        l.relations.filter((r) => r.b === '日支').map((r) => `${l.year}${r.type}日支`),
      );
      return hits.length ? hits.join('、') : null;
    }
    case 'CH7-HEALTH': {
      if (!item) throw new RenderError('CH7-HEALTH 依据需要 item（五行）');
      return `${item.element}占 ${pp[String(item.element)]}%`;
    }
    default:
      return null;
  }
}

function roleName(r: unknown): string {
  return r === '用' ? '用神' : r === '喜' ? '喜神' : r === '忌' ? '忌神' : '闲神';
}
