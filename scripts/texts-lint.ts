/**
 * npm run texts:lint —— 素材 lint（rules/texts/README.md §7；TASKS T24 / T25）。
 *
 * 读取 rules/texts/*.yaml（batches.yaml 除外）→ YAML 子集 + schema（L1）→ lintEntries（L1–L6）→ 逐条输出「条目 id  规则  原因」。
 * 词表读 rules/texts/wordlists/{forbidden,disease,finance,whitelist}.txt（每行一个词，# 开头为注释）；
 * forbidden.txt 未就绪时回退到 report-sections.md §7 的禁用词表，disease / finance 未就绪时跳过并提示。
 * 有任何问题时退出码为 1。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lintEntries,
  parseForbiddenWordsFromMd,
  type Wordlists,
} from '../packages/core/src/texts/lint';
import { parseTextsYaml, TextsYamlError } from '../packages/core/src/texts/yaml';
import type { TextEntry } from '../packages/core/src/texts/schema';

const ROOT = join(import.meta.dirname, '..');
const TEXTS = join(ROOT, 'rules/texts');
const WORDS = join(TEXTS, 'wordlists');

function readWordFile(name: string): string[] | null {
  const p = join(WORDS, `${name}.txt`);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const notes: string[] = [];
const forbidden =
  readWordFile('forbidden') ??
  (notes.push('wordlists/forbidden.txt 未就绪，使用 report-sections.md §7 禁用词表'),
  parseForbiddenWordsFromMd(readFileSync(join(ROOT, 'rules/report-sections.md'), 'utf8')));
const disease =
  readWordFile('disease') ?? (notes.push('wordlists/disease.txt 未就绪，跳过疾病名词检查'), []);
const finance =
  readWordFile('finance') ?? (notes.push('wordlists/finance.txt 未就绪，跳过金融产品词检查'), []);
const whitelist = readWordFile('whitelist') ?? [];
const words: Wordlists = { forbidden, disease, finance, whitelist };

const files = readdirSync(TEXTS)
  .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
  .sort();
const entries: TextEntry[] = [];
const lines: string[] = [];
const seen = new Map<string, string>();
for (const file of files) {
  try {
    for (const e of parseTextsYaml(file, readFileSync(join(TEXTS, file), 'utf8'))) {
      const prev = seen.get(e.id);
      if (prev) lines.push(`${e.id}\tL1\tid 与 ${prev} 中的条目重复`);
      seen.set(e.id, file);
      entries.push(e);
    }
  } catch (err) {
    if (!(err instanceof TextsYamlError)) throw err;
    for (const p of err.problems) lines.push(`(${file})\tL1\t${p}`);
  }
}
const issues = lintEntries(entries, words);
for (const i of issues) lines.push(`${i.id}\t${i.rule}\t${i.message}`);

for (const n of notes) console.log(`提示：${n}`);
for (const l of lines) console.log(l);
const byRule = new Map<string, number>();
for (const l of lines)
  byRule.set(l.split('\t')[1] as string, (byRule.get(l.split('\t')[1] as string) ?? 0) + 1);
console.log(
  `\n${files.length} 个文件，${entries.length} 条素材，${lines.length} 个问题` +
    (lines.length ? `（${[...byRule].map(([r, n]) => `${r} ${n}`).join('，')}）` : ''),
);
process.exitCode = lines.length > 0 ? 1 : 0;
