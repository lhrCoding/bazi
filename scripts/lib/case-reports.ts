/**
 * 为 cases.json 全部案例跑完整拼装（texts:preview 与 texts:batch 抽检单共用）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, computeChart } from '../../packages/core/src/index';
import {
  assembleReport,
  limitationsFromStrengthMd,
  type Report,
} from '../../packages/core/src/report/assemble';
import { rcheck, type RCheckResult } from '../../packages/core/src/report/check';
import { buildCtx, type Ctx } from '../../packages/core/src/report/ctx';
import { createLibrary, type TextStatus } from '../../packages/core/src/report/select';
import { parseForbiddenWordsFromMd } from '../../packages/core/src/texts/lint';
import type { TextEntry } from '../../packages/core/src/texts/schema';
import { glossaryFromReadme } from '../../packages/core/src/texts/yaml';
import { toBirthInput, type RawCase } from '../../packages/core/test/helpers/cases';

export const PREVIEW_REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');

export interface CaseReport {
  id: string;
  title: string;
  ctx: Ctx;
  report: Report;
  check: RCheckResult;
}

/** @param rulesDir 仓库 rules/ 目录 */
export function buildCaseReports(
  rulesDir: string,
  entries: readonly TextEntry[],
  allowed: readonly TextStatus[],
): CaseReport[] {
  const read = (p: string): string => readFileSync(join(rulesDir, p), 'utf8');
  const library = createLibrary(entries, allowed);
  const glossary = glossaryFromReadme(read('texts/README.md'));
  const limitations = limitationsFromStrengthMd(read('strength.md'));
  const whitelist = read('texts/wordlists/whitelist.txt')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const words = {
    forbidden: parseForbiddenWordsFromMd(read('report-sections.md')),
    disease: [],
    finance: [],
    whitelist,
  };
  const cases = (JSON.parse(read('cases.json')) as { cases: (RawCase & { title?: string })[] })
    .cases;
  return cases.map((c) => {
    const chart = computeChart(toBirthInput(c), PREVIEW_REF_DATE_MS);
    const analysis = analyze(chart);
    const ctx = buildCtx(chart, analysis);
    const report = assembleReport({
      chart,
      analysis,
      ctx,
      library,
      glossary,
      textsVersion: 'preview',
      limitations,
    });
    return { id: c.id, title: c.title ?? '', ctx, report, check: rcheck(report, ctx, words) };
  });
}
