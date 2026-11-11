/**
 * 素材脚本共用：读取 rules/texts（素材文件、词表、术语表）并跑 L1–L12。texts:lint 与 texts:batch 共用，保证同一口径。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lintEntries,
  parseForbiddenWordsFromMd,
  type Wordlists,
} from '../../packages/core/src/texts/lint';
import type { TextEntry } from '../../packages/core/src/texts/schema';
import {
  glossaryFromReadme,
  parseGlossaryYaml,
  parseTextsYaml,
  TextsYamlError,
} from '../../packages/core/src/texts/yaml';

export interface LoadedTexts {
  files: string[];
  entries: TextEntry[];
  /** 条目 id → 所在文件名 */
  fileOf: Map<string, string>;
  /** 「id\t规则\t原因」；文件级问题的 id 写作 (文件名) */
  problems: string[];
  notes: string[];
}

function readWordFile(dir: string, name: string): string[] | null {
  const p = join(dir, `${name}.txt`);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * @param textsDir rules/texts 目录
 * @param sectionsMd report-sections.md 全文（forbidden.txt 未就绪时解析其 §7 禁用词表）
 */
export function loadAndLintTexts(textsDir: string, sectionsMd: string): LoadedTexts {
  const notes: string[] = [];
  const words = join(textsDir, 'wordlists');
  const forbidden =
    readWordFile(words, 'forbidden') ??
    (notes.push('wordlists/forbidden.txt 未就绪，使用 report-sections.md §7 禁用词表'),
    parseForbiddenWordsFromMd(sectionsMd));
  const disease =
    readWordFile(words, 'disease') ??
    (notes.push('wordlists/disease.txt 未就绪，跳过疾病名词检查'), []);
  const finance =
    readWordFile(words, 'finance') ??
    (notes.push('wordlists/finance.txt 未就绪，跳过金融产品词检查'), []);
  const whitelist = readWordFile(words, 'whitelist') ?? [];
  const wl: Wordlists = { forbidden, disease, finance, whitelist };
  const glossaryPath = join(textsDir, 'glossary.yaml');
  const glossary = existsSync(glossaryPath)
    ? parseGlossaryYaml('glossary.yaml', readFileSync(glossaryPath, 'utf8'))
    : (notes.push('glossary.yaml 未就绪，L9 使用 README §8 示例术语表'),
      glossaryFromReadme(readFileSync(join(textsDir, 'README.md'), 'utf8')));

  const files = readdirSync(textsDir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml' && f !== 'glossary.yaml')
    .sort();
  const entries: TextEntry[] = [];
  const fileOf = new Map<string, string>();
  const problems: string[] = [];
  for (const file of files) {
    try {
      for (const e of parseTextsYaml(file, readFileSync(join(textsDir, file), 'utf8'))) {
        const prev = fileOf.get(e.id);
        if (prev) problems.push(`${e.id}\tL1\tid 与 ${prev} 中的条目重复`);
        fileOf.set(e.id, file);
        entries.push(e);
      }
    } catch (err) {
      if (!(err instanceof TextsYamlError)) throw err;
      for (const p of err.problems) problems.push(`(${file})\tL1\t${p}`);
    }
  }
  for (const i of lintEntries(entries, wl, { glossary: glossary.map((g) => g.term) })) {
    problems.push(`${i.id}\t${i.rule}\t${i.message}`);
  }
  return { files, entries, fileOf, problems, notes };
}
