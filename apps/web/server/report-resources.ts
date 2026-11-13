/**
 * 报告拼装用的固定资源（TASKS T53）：术语表、「已知局限」、R-CHECK 词表。从仓库 rules/ 读取，进程内缓存。
 * RULES_DIR 默认「工作目录/../../rules」（apps/web 运行时即仓库 rules/）。
 * 技术债：这些资源未进入素材发布快照，改动 rules/ 会影响已售报告的术语加注（K01 建 glossary.yaml 时一并放进快照）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseForbiddenWordsFromMd, type Wordlists } from '@zhiming/core/texts';
import { glossaryFromReadme, type GlossaryItem } from '@zhiming/core/texts/yaml';
import { limitationsFromStrengthMd } from '@zhiming/core/report';

export interface ReportResources {
  glossary: readonly GlossaryItem[];
  limitations: readonly string[];
  words: Wordlists;
}

export function loadReportResources(rulesDir: string): ReportResources {
  const read = (p: string): string => readFileSync(join(rulesDir, p), 'utf8');
  const whitelist = read('texts/wordlists/whitelist.txt')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return {
    glossary: glossaryFromReadme(read('texts/README.md')),
    limitations: limitationsFromStrengthMd(read('strength.md')),
    words: {
      forbidden: parseForbiddenWordsFromMd(read('report-sections.md')),
      disease: [],
      finance: [],
      whitelist,
    },
  };
}

export const defaultRulesDir = (env: NodeJS.ProcessEnv): string =>
  env.RULES_DIR || join(process.cwd(), '..', '..', 'rules');
