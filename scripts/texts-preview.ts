/**
 * npm run texts:preview —— 用 cases.json 全部案例生成完整报告 HTML（ARCHITECTURE §4.3.8；TASKS T37）。
 * 输出到仓库根目录 preview/（.gitignore，不提交）：index.html + 每个案例一页。素材含 draft / reviewed / approved。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCaseReports } from './lib/case-reports';
import { indexHtml, reportHtml } from './lib/preview-html';
import { loadAndLintTexts } from './lib/texts-load';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'preview');
const { entries } = loadAndLintTexts(
  join(ROOT, 'rules/texts'),
  readFileSync(join(ROOT, 'rules/report-sections.md'), 'utf8'),
);
const list = buildCaseReports(join(ROOT, 'rules'), entries, ['draft', 'reviewed', 'approved']);
mkdirSync(OUT, { recursive: true });
for (const r of list) writeFileSync(join(OUT, `${r.id}.html`), reportHtml(r));
writeFileSync(join(OUT, 'index.html'), indexHtml(list));
console.log(`已生成 ${list.length} 份报告预览：${join(OUT, 'index.html')}`);
