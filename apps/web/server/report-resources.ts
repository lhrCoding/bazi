/**
 * 报告拼装用的固定资源（TASKS T53；K01 起改读 rules/texts/glossary.yaml 与 wordlists/）。
 *
 * - 术语表：rules/texts/glossary.yaml（缺失时回退 README §8 示例）。**发布后随素材快照冻结**（texts-store 按版本取），
 *   已售报告的术语加注不受此文件后续修改影响；本文件的 loadGlossary 只用于开发工作区与发布脚本。
 * - R-CHECK 词表：wordlists/forbidden.txt（缺失时回退 report-sections.md §7）、disease.txt、finance.txt、whitelist.txt。
 * - 「已知局限」：strength.md §8（属于规则文件，随 RULES_VERSION 变化）。
 * RULES_DIR 默认「工作目录/../../rules」（apps/web 运行时即仓库 rules/）。脚本（scripts/）也复用这里的加载函数。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseForbiddenWordsFromMd, type Wordlists } from '@zhiming/core/texts';
import { glossaryFromReadme, parseGlossaryYaml, type GlossaryItem } from '@zhiming/core/texts/yaml';
import { limitationsFromStrengthMd } from '@zhiming/core/report';

export interface ReportResources {
  limitations: readonly string[];
  words: Wordlists;
}

function readList(path: string): string[] | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** @param textsDir rules/texts */
export function loadGlossary(textsDir: string): GlossaryItem[] {
  const p = join(textsDir, 'glossary.yaml');
  return existsSync(p)
    ? parseGlossaryYaml('glossary.yaml', readFileSync(p, 'utf8'))
    : glossaryFromReadme(readFileSync(join(textsDir, 'README.md'), 'utf8'));
}

/** @param rulesDir 仓库 rules/ */
export function loadWordlists(rulesDir: string): Wordlists {
  const wl = join(rulesDir, 'texts', 'wordlists');
  return {
    forbidden:
      readList(join(wl, 'forbidden.txt')) ??
      parseForbiddenWordsFromMd(readFileSync(join(rulesDir, 'report-sections.md'), 'utf8')),
    disease: readList(join(wl, 'disease.txt')) ?? [],
    finance: readList(join(wl, 'finance.txt')) ?? [],
    whitelist: readList(join(wl, 'whitelist.txt')) ?? [],
  };
}

export function loadReportResources(rulesDir: string): ReportResources {
  return {
    limitations: limitationsFromStrengthMd(readFileSync(join(rulesDir, 'strength.md'), 'utf8')),
    words: loadWordlists(rulesDir),
  };
}

export const defaultRulesDir = (env: NodeJS.ProcessEnv): string =>
  env.RULES_DIR || join(process.cwd(), '..', '..', 'rules');
