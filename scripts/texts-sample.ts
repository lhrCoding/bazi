/**
 * npm run texts:sample —— 动态覆盖率 + 字数分布（rules/report-sections.md §5.1 第 3 条；TASKS T35）。
 *
 * 样本 = cases.json 全部案例 + 有时辰案例去掉时柱 + 随机 N 个出生时刻（默认 10,000；1940–2030，男女各半，10% 无时辰；
 * 种子固定）。逐个跑完整拼装与 R-CHECK，输出四项指标：兜底 / 空槽、字数达标率、R-CHECK 不通过数、asserts 素材缺陷；
 * 以及标准案例（cases.json）逐章字数分布表（供 QA_REPORT）。开发期素材含 draft；--approved-only 为生产口径。
 * 参数：--n 10000 --seed 20261112
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { limitationsFromStrengthMd } from '../packages/core/src/report/assemble';
import { randomBirthInputs, runSample } from '../packages/core/src/report/sample';
import { createLibrary } from '../packages/core/src/report/select';
import { parseForbiddenWordsFromMd } from '../packages/core/src/texts/lint';
import { glossaryFromReadme } from '../packages/core/src/texts/yaml';
import { toBirthInput, type RawCase } from '../packages/core/test/helpers/cases';
import { loadAndLintTexts } from './lib/texts-load';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const arg = (name: string, d: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const N = arg('n', 10000);
const SEED = arg('seed', 20261112);
const approvedOnly = process.argv.includes('--approved-only');

const { entries } = loadAndLintTexts(join(ROOT, 'rules/texts'), read('rules/report-sections.md'));
const library = createLibrary(
  entries,
  approvedOnly ? ['approved'] : ['draft', 'reviewed', 'approved'],
);
const whitelistFile = read('rules/texts/wordlists/whitelist.txt');
const opts = {
  library,
  glossary: glossaryFromReadme(read('rules/texts/README.md')),
  words: {
    forbidden: parseForbiddenWordsFromMd(read('rules/report-sections.md')),
    disease: [],
    finance: [],
    whitelist: whitelistFile
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  },
  limitations: limitationsFromStrengthMd(read('rules/strength.md')),
  textsVersion: 'dev',
  refDateMs: Date.parse('2026-10-30T00:00:00+08:00'),
};

const cases = (JSON.parse(read('rules/cases.json')) as { cases: RawCase[] }).cases;
const caseInputs = cases.map(toBirthInput);
const stripped = caseInputs.filter((i) => i.time !== null).map((i) => ({ ...i, time: null }));
const t0 = Date.now();
const std = runSample(caseInputs, opts, true);
const all = runSample([...caseInputs, ...stripped, ...randomBirthInputs(N, SEED)], opts);
const sec = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
console.log(
  `样本 ${all.samples}（案例 ${caseInputs.length} + 去时柱 ${stripped.length} + 随机 ${N}，种子 ${SEED}），用时 ${sec} 秒`,
);
console.log(`排盘报错（不计入）：${all.invalidInputs}`);
console.log(`\n① 兜底 / 空槽：有兜底或空槽的报告 ${all.reportsWithFallback} 份`);
for (const [k, v] of Object.entries(all.fallbackUsed)) console.log(`  fallback_used ${k}: ${v}`);
for (const [k, v] of Object.entries(all.slotEmpty)) console.log(`  slot_empty ${k}: ${v}`);
console.log(`② 字数达标率：${pct(all.lengthPassRate)}（目标 ≥ 99%）`);
console.log(`③ R-CHECK 不通过的报告数：${JSON.stringify(all.rcheckFailedReports)}`);
console.log(`④ asserts 素材缺陷（when 成立而 asserts 不成立）：${all.assertDefects.length} 条`);
for (const d of all.assertDefects)
  console.log(`  ${d.entry}（${d.slot}）×${d.count}，首次出现于样本 #${d.firstSample}`);

console.log('\n标准案例逐章字数（第 1–7 章 / 全文）：');
console.log(['案例', '1', '2', '3', '4', '5', '6', '7', '全文'].join('\t'));
std.lengths?.forEach((l, i) =>
  console.log(
    [cases[i]?.id, ...[1, 2, 3, 4, 5, 6, 7].map((c) => l.chapters[c] ?? 0), l.total].join('\t'),
  ),
);
