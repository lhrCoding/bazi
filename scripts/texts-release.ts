/**
 * npm run texts:release —— 发布素材库快照（ARCHITECTURE §4.3.8；TASKS T38）。
 *
 * 只收 approved；要求 lint 全过、静态覆盖率 100%（全部必需槽位、兜底各 1 条）、动态抽样全部达标（兜底 / 空槽 0、
 * asserts 缺陷 0、字数达标率 ≥ 99%、R-CHECK 全部通过）；与上一快照比对（approved 条目只许追加变体）。
 * 通过后写 apps/web/texts-releases/v{N}.json，并提示打 tag texts-v{N}（不自动打 tag：对外可见操作，需用户确认）。
 * 参数：--n 10000（动态抽样数） --dry-run（只检查不写文件）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, computeChart, RULES_VERSION } from '../packages/core/src/index';
import { limitationsFromStrengthMd } from '../packages/core/src/report/assemble';
import { buildCtx } from '../packages/core/src/report/ctx';
import { randomBirthInputs, runSample } from '../packages/core/src/report/sample';
import { createLibrary } from '../packages/core/src/report/select';
import { computeCoverage } from '../packages/core/src/texts/coverage';
import { parseForbiddenWordsFromMd } from '../packages/core/src/texts/lint';
import { buildRelease, SnapshotSchema, type Snapshot } from '../packages/core/src/texts/release';
import { glossaryFromReadme } from '../packages/core/src/texts/yaml';
import { toBirthInput, type RawCase } from '../packages/core/test/helpers/cases';
import { loadAndLintTexts } from './lib/texts-load';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'apps/web/texts-releases');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const i = process.argv.indexOf('--n');
const N = i >= 0 ? Number(process.argv[i + 1]) : 10000;
const dryRun = process.argv.includes('--dry-run');
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

const { entries, problems: lint } = loadAndLintTexts(
  join(ROOT, 'rules/texts'),
  read('rules/report-sections.md'),
);
const approved = entries.filter((e) => e.status === 'approved');

// 静态覆盖率：只统计 approved，全部必需槽位
const cases = (JSON.parse(read('rules/cases.json')) as { cases: RawCase[] }).cases;
const c16 = cases.find((c) => c.id === 'C16') as RawCase;
const chart16 = computeChart(toBirthInput(c16), Date.parse('2026-10-30T00:00:00+08:00'));
const cov = computeCoverage(approved, buildCtx(chart16, analyze(chart16)) as never, ['approved']);
const staticCoverage = [
  ...cov.gaps.map((g) => `${g.slot} ${JSON.stringify(g.combo)}`),
  ...cov.fallbackProblems,
  ...cov.unspecified.map((s) => `${s} 没有穷举定义`),
];

// 动态抽样（只在静态覆盖率通过后跑，避免空耗）
const dynamic: string[] = [];
if (approved.length > 0 && staticCoverage.length === 0) {
  const whitelist = read('rules/texts/wordlists/whitelist.txt')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const caseInputs = cases.map(toBirthInput);
  const m = runSample(
    [
      ...caseInputs,
      ...caseInputs.filter((x) => x.time).map((x) => ({ ...x, time: null })),
      ...randomBirthInputs(N, 20261112),
    ],
    {
      library: createLibrary(approved, ['approved']),
      glossary: glossaryFromReadme(read('rules/texts/README.md')),
      words: {
        forbidden: parseForbiddenWordsFromMd(read('rules/report-sections.md')),
        disease: [],
        finance: [],
        whitelist,
      },
      limitations: limitationsFromStrengthMd(read('rules/strength.md')),
      textsVersion: 'release-check',
      refDateMs: Date.parse('2026-10-30T00:00:00+08:00'),
    },
  );
  if (m.reportsWithFallback > 0) dynamic.push(`有兜底或空槽的报告 ${m.reportsWithFallback} 份`);
  for (const d of m.assertDefects) dynamic.push(`asserts 缺陷 ${d.entry} ×${d.count}`);
  if (m.lengthPassRate < 0.99)
    dynamic.push(`字数达标率 ${(m.lengthPassRate * 100).toFixed(1)}% < 99%`);
  for (const [rule, n] of Object.entries(m.rcheckFailedReports))
    dynamic.push(`R-CHECK ${rule} 不通过 ${n} 份`);
} else if (approved.length > 0) {
  dynamic.push('静态覆盖率未通过，未运行动态抽样');
}

// 上一快照
mkdirSync(OUT, { recursive: true });
const versions = readdirSync(OUT)
  .map((f) => /^v(\d+)\.json$/.exec(f)?.[1])
  .filter((x): x is string => x !== undefined)
  .map(Number);
const last = versions.length ? Math.max(...versions) : null;
const prev: Snapshot | null =
  last === null
    ? null
    : SnapshotSchema.parse(JSON.parse(read(`apps/web/texts-releases/v${last}.json`)));

const r = buildRelease(
  entries,
  prev,
  { rulesVersion: RULES_VERSION, releasedAt: today },
  { lint, staticCoverage, dynamic },
);
if (!r.snapshot) {
  console.error(`发布被拒绝（${r.problems.length} 项）：`);
  for (const p of r.problems.slice(0, 50)) console.error(`  ${p}`);
  if (r.problems.length > 50) console.error(`  …… 另有 ${r.problems.length - 50} 项`);
  process.exit(1);
}
const file = join(OUT, `v${r.snapshot.textsVersion}.json`);
if (existsSync(file)) throw new Error(`${file} 已存在`);
if (dryRun) {
  console.log(
    `[dry-run] 检查全部通过，将发布 v${r.snapshot.textsVersion}（${r.snapshot.entries.length} 条）`,
  );
} else {
  writeFileSync(file, `${JSON.stringify(r.snapshot, null, 2)}\n`);
  console.log(`已发布 ${file}（${r.snapshot.entries.length} 条，规则版本 ${RULES_VERSION}）`);
  console.log(`提交后请确认再打 tag：git tag texts-v${r.snapshot.textsVersion}`);
}
