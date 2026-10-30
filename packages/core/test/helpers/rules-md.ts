/**
 * 解析 rules/*.md 的测试工具（T14）：规则编号、JSON 参数块、文件清单。
 * 只在测试中使用 Node IO；rules/ 只读。
 */
import { readdirSync } from 'node:fs';
import { RULES_DIR, readRulesFile } from './fixtures';

/**
 * 规则编号：CAL- / S- / Y- / SS- / R- 后接以大写字母开头的段，之后可再接若干大写字母数字段（用 - 连接）。
 * 第一段必须以字母开头，避免把 "Y-1 年"（年份减一）这类算式当成编号。
 * 前面不能紧挨字母、数字、下划线或连字符（避免把 "CH1-…"、"SHA-256" 这类串的一部分当成编号）。
 * "Y-TH-*" 这类通配写法按 "Y-TH" 计。
 */
export const RULE_ID_RE = /(?<![A-Za-z0-9_-])((?:CAL|SS|S|Y|R)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)/g;

export function extractRuleIds(text: string): string[] {
  return [...text.matchAll(RULE_ID_RE)].map((m) => m[1] as string);
}

/** rules/ 根目录下的 .md 文件名（升序）。 */
export function listRulesMarkdown(): string[] {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/** 各 md 文件中出现的编号：文件名 → 编号集合。 */
export function ruleIdsByFile(): Map<string, Set<string>> {
  return new Map(listRulesMarkdown().map((f) => [f, new Set(extractRuleIds(readRulesFile(f)))]));
}

export interface JsonBlock {
  /** 所在文件 */
  file: string;
  /** 代码块之前最近的一级～四级标题（去掉 # 与首尾空白） */
  heading: string;
  /** ```json 所在行号（从 1 起） */
  line: number;
  /** 解析后的值 */
  value: unknown;
}

/** 提取 md 中全部 ```json 代码块（按出现顺序）。 */
export function extractJsonBlocks(file: string): JsonBlock[] {
  const lines = readRulesFile(file).split('\n');
  const blocks: JsonBlock[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    if (h) {
      heading = (h[1] as string).trim();
      continue;
    }
    const fence = /^\s*```(\S*)\s*$/.exec(l);
    if (fence) {
      // 代码块内的 "# …"（如伪代码注释）不是标题，整块跳过
      const end = lines.findIndex((x, j) => j > i && x.trim() === '```');
      if (end < 0) throw new Error(`${file}:${i + 1} 的代码块没有结束标记`);
      if (fence[1] === 'json') {
        blocks.push({
          file,
          heading,
          line: i + 1,
          value: JSON.parse(lines.slice(i + 1, end).join('\n')),
        });
      }
      i = end;
    }
  }
  return blocks;
}
