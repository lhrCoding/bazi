/**
 * npm run texts:lint —— 素材 lint L1–L12（rules/texts/README.md §7；TASKS T24 / T25）。
 *
 * 读取 rules/texts/*.yaml（batches.yaml、glossary.yaml 除外）→ YAML 子集 + schema（L1）→ lintEntries（L1–L12）
 * → 逐条输出「条目 id  规则  原因」。词表读 rules/texts/wordlists/{forbidden,disease,finance,whitelist}.txt
 * （每行一个词，# 开头为注释）；forbidden.txt 未就绪时回退到 report-sections.md §7，disease / finance 未就绪时跳过；
 * glossary.yaml 未就绪时用 README §8 示例。有任何问题时退出码为 1。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAndLintTexts } from './lib/texts-load';

const ROOT = join(import.meta.dirname, '..');
const { files, entries, problems, notes } = loadAndLintTexts(
  join(ROOT, 'rules/texts'),
  readFileSync(join(ROOT, 'rules/report-sections.md'), 'utf8'),
);
for (const n of notes) console.log(`提示：${n}`);
for (const l of problems) console.log(l);
const byRule = new Map<string, number>();
for (const l of problems) {
  const r = l.split('\t')[1] as string;
  byRule.set(r, (byRule.get(r) ?? 0) + 1);
}
console.log(
  `\n${files.length} 个文件，${entries.length} 条素材，${problems.length} 个问题` +
    (problems.length ? `（${[...byRule].map(([r, n]) => `${r} ${n}`).join('，')}）` : ''),
);
process.exitCode = problems.length > 0 ? 1 : 0;
