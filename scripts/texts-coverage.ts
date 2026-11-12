/**
 * npm run texts:coverage —— 素材静态覆盖率（rules/report-sections.md §5.1；TASKS T34）。
 *
 * 读取 rules/texts 全部素材（开发期统计 draft / reviewed / approved；--approved-only 只统计 approved），
 * 以 cases.json C16 的 ctx 为基准穷举各必需槽位的维度组合，输出每槽位覆盖数、缺口清单（槽位 + 组合）与兜底问题。
 * 强制范围由 batches.yaml 推导：status = approved 的批次 scope 内的章节有缺口 → 退出码 1；其余只报告。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { analyze, computeChart } from '../packages/core/src/index';
import { buildCtx } from '../packages/core/src/report/ctx';
import {
  computeCoverage,
  enforcedChapters,
  enforcedFailures,
} from '../packages/core/src/texts/coverage';
import { toBirthInput, type RawCase } from '../packages/core/test/helpers/cases';
import { loadAndLintTexts } from './lib/texts-load';

const ROOT = join(import.meta.dirname, '..');
const TEXTS = join(ROOT, 'rules/texts');
const approvedOnly = process.argv.includes('--approved-only');
const { entries } = loadAndLintTexts(
  TEXTS,
  readFileSync(join(ROOT, 'rules/report-sections.md'), 'utf8'),
);
const cases = (
  JSON.parse(readFileSync(join(ROOT, 'rules/cases.json'), 'utf8')) as { cases: RawCase[] }
).cases;
const c16 = cases.find((c) => c.id === 'C16');
if (!c16) throw new Error('cases.json 缺少 C16');
const chart = computeChart(toBirthInput(c16), Date.parse('2026-10-30T00:00:00+08:00'));
const base = buildCtx(chart, analyze(chart)) as unknown as Record<string, unknown>;

const r = computeCoverage(
  entries,
  base,
  approvedOnly ? ['approved'] : ['draft', 'reviewed', 'approved'],
);
const enforced = enforcedChapters(
  parse(readFileSync(join(TEXTS, 'batches.yaml'), 'utf8')) as never,
);
console.log(
  `统计状态：${approvedOnly ? 'approved' : 'draft + reviewed + approved'}；强制章节：${enforced.length ? enforced.join('、') : '无（尚无已批准批次）'}`,
);
for (const s of r.slots)
  console.log(`${s.slot}\t${s.covered}/${s.combos}${s.covered === s.combos ? '' : '\t缺口'}`);
if (r.gaps.length) {
  console.log(`\n缺口 ${r.gaps.length} 个：`);
  for (const g of r.gaps) console.log(`${g.slot}\t${JSON.stringify(g.combo)}`);
}
if (r.fallbackProblems.length) console.log(`\n兜底问题：\n${r.fallbackProblems.join('\n')}`);
const failures = enforcedFailures(r, enforced);
console.log(`\n强制范围内失败 ${failures.length} 项`);
process.exitCode = failures.length > 0 ? 1 : 0;
