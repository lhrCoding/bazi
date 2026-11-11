/**
 * 素材 YAML 解析（TASKS T22；rules/texts/README.md §1、ARCHITECTURE §2 / §4.3）。
 *
 * - 只做「字符串 → 条目数组」，不读文件（core 不做 IO；读文件由 scripts / 测试完成后传入）。
 * - 只用 YAML 标准子集：遇到锚点（&）、别名（*）、自定义 / 显式 tag（!foo、!!str）、合并键（<<）直接报错，在 AST 级检查，
 *   不依赖解析后的值。
 * - 解析用 YAML 1.2 core schema：日期 2026-10-29 保持为字符串。
 * - 本模块只在构建脚本 / 测试里使用；运行时加载编译好的 JSON（T38），因此不从 texts/index.ts 的运行时入口导出。
 */
import { isAlias, isNode, isPair, isScalar, parseDocument, visit } from 'yaml';
import { TextEntrySchema, type TextEntry } from './schema';

export class TextsYamlError extends Error {
  constructor(
    readonly file: string,
    readonly problems: readonly string[],
  ) {
    super(`${file}：\n  ${problems.join('\n  ')}`);
    this.name = 'TextsYamlError';
  }
}

function lineOf(source: string, offset: number | undefined): number {
  if (offset === undefined) return 0;
  let n = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') n++;
  return n;
}

/** AST 级检查：锚点、别名、tag、合并键。返回问题列表。 */
export function checkYamlSubset(source: string): string[] {
  const doc = parseDocument(source, { version: '1.2', schema: 'core', uniqueKeys: true });
  const problems: string[] = [];
  for (const err of doc.errors)
    problems.push(`第 ${lineOf(source, err.pos[0])} 行：YAML 语法错误 ${err.message}`);
  for (const w of doc.warnings) problems.push(`第 ${lineOf(source, w.pos[0])} 行：${w.message}`);
  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      problems.push(`第 ${lineOf(source, node.range?.[0])} 行：不允许使用别名 *${node.source}`);
      return;
    }
    if (isNode(node)) {
      if (node.anchor)
        problems.push(`第 ${lineOf(source, node.range?.[0])} 行：不允许使用锚点 &${node.anchor}`);
      // 解析后的节点只有源文本里显式写了 tag（!foo、!!str）时才带 tag 属性
      if (node.tag)
        problems.push(`第 ${lineOf(source, node.range?.[0])} 行：不允许使用 tag ${node.tag}`);
    }
    if (isPair(node) && isScalar(node.key) && node.key.value === '<<') {
      problems.push(`第 ${lineOf(source, node.key.range?.[0])} 行：不允许使用合并键 <<`);
    }
  });
  return problems;
}

/**
 * 解析一个素材文件：子集检查 → 顶层必须是数组 → 每条按 TextEntrySchema 校验；同文件内 id 重复也报错。
 * 任一问题都抛 TextsYamlError（列出全部问题，而不是遇到第一个就停）。
 */
export function parseTextsYaml(file: string, source: string): TextEntry[] {
  const problems = checkYamlSubset(source);
  if (problems.length > 0) throw new TextsYamlError(file, problems);
  const data: unknown = parseDocument(source, { version: '1.2', schema: 'core' }).toJS();
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new TextsYamlError(file, ['顶层必须是条目数组']);
  const out: TextEntry[] = [];
  const seen = new Set<string>();
  data.forEach((raw, i) => {
    const r = TextEntrySchema.safeParse(raw);
    const id = (raw as { id?: unknown } | null)?.id;
    const label = `第 ${i + 1} 条${typeof id === 'string' ? `（${id}）` : ''}`;
    if (!r.success) {
      for (const iss of r.error.issues)
        problems.push(`${label} ${iss.path.join('.') || '(根)'}：${iss.message}`);
      return;
    }
    if (seen.has(r.data.id)) problems.push(`${label}：id 重复`);
    seen.add(r.data.id);
    out.push(r.data);
  });
  if (problems.length > 0) throw new TextsYamlError(file, problems);
  return out;
}

/** 多个文件合并：跨文件 id 也必须唯一 */
export function parseTextsFiles(files: readonly { file: string; source: string }[]): TextEntry[] {
  const all: TextEntry[] = [];
  const where = new Map<string, string>();
  const problems: string[] = [];
  for (const { file, source } of files) {
    for (const e of parseTextsYaml(file, source)) {
      const prev = where.get(e.id);
      if (prev !== undefined) problems.push(`${e.id}：在 ${prev} 与 ${file} 中重复`);
      where.set(e.id, file);
      all.push(e);
    }
  }
  if (problems.length > 0) throw new TextsYamlError('(全库)', problems);
  return all;
}

/** 术语加注表（README §8）：[{term, note}]，只收两字及以上的术语 */
export interface GlossaryItem {
  term: string;
  note: string;
}

export function parseGlossaryYaml(file: string, source: string): GlossaryItem[] {
  const problems = checkYamlSubset(source);
  if (problems.length > 0) throw new TextsYamlError(file, problems);
  const data: unknown = parseDocument(source, { version: '1.2', schema: 'core' }).toJS();
  if (!Array.isArray(data)) throw new TextsYamlError(file, ['顶层必须是术语数组']);
  const out: GlossaryItem[] = [];
  data.forEach((x, i) => {
    const o = x as Partial<GlossaryItem> | null;
    if (!o || typeof o.term !== 'string' || typeof o.note !== 'string' || [...o.term].length < 2) {
      problems.push(`第 ${i + 1} 条：需要 term（两字及以上）与 note`);
    } else out.push({ term: o.term, note: o.note });
  });
  if (problems.length > 0) throw new TextsYamlError(file, problems);
  return out;
}

/** 从 README §8 取示例术语表（glossary.yaml 未就绪时的回退） */
export function glossaryFromReadme(readme: string): GlossaryItem[] {
  const sec = readme.slice(readme.indexOf('## 8. 术语加注表'));
  const m = /```yaml\n([\s\S]*?)```/.exec(sec);
  if (!m) throw new Error('README §8 中找不到术语表示例');
  return parseGlossaryYaml('README §8', m[1] as string);
}
