/**
 * T37 预览 HTML：每个案例一页 + 目录；手机宽度可读（viewport、单栏、表格可横向滚动、无超过 375 px 的固定宽度）。
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCaseReports } from '../../../scripts/lib/case-reports';
import { esc, indexHtml, reportHtml } from '../../../scripts/lib/preview-html';
import { loadAndLintTexts } from '../../../scripts/lib/texts-load';
import { readRulesFile } from './helpers/fixtures';

const RULES = fileURLToPath(new URL('../../../rules/', import.meta.url));
const { entries } = loadAndLintTexts(`${RULES}texts`, readRulesFile('report-sections.md'));
const list = buildCaseReports(RULES, entries, ['draft', 'reviewed', 'approved']);

describe('预览 HTML', () => {
  it('20 个案例各一页：9 章标题齐全、无残留占位符、HTML 转义', () => {
    expect(list).toHaveLength(20);
    for (const r of list) {
      const h = reportHtml(r);
      for (const n of ['〇', '一', '二', '三', '四', '五', '六', '七', '八'])
        expect(h, r.id).toContain(`第${n}章`);
      expect(h).not.toMatch(/\{[a-z_]+\.[^}]*\}/);
      expect(h).toContain(r.ctx.chart_key.replace('|', '|'));
    }
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });

  it('手机宽度可读：viewport、单栏 max-width、表格外包可横向滚动容器、固定宽度都 ≤ 375 px', () => {
    for (const r of list) {
      const h = reportHtml(r);
      expect(h).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
      expect(h).toContain('max-width:680px');
      const tables = (h.match(/<table>/g) ?? []).length;
      expect((h.match(/<div class="table-wrap"><table>/g) ?? []).length, r.id).toBe(tables);
      // 只看固定 width，不含 max-width / min-width
      const widths = [...h.matchAll(/(?<![-\w])width:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
      expect(widths.length, r.id).toBeGreaterThan(0);
      expect(
        widths.filter((w) => w > 375),
        r.id,
      ).toEqual([]);
    }
  });

  it('逐年卡片 5 张，含立春与档位；图一百分比为整数', () => {
    const h = reportHtml(list.find((r) => r.id === 'C16') as (typeof list)[number]);
    expect((h.match(/class="card"/g) ?? []).length).toBe(5);
    expect(h).toMatch(/2026 丙午年/);
    expect(h).toMatch(/立春起/);
    expect(h).not.toMatch(/\d+\.\d{3,}%/);
  });

  it('目录页列出全部案例与 R-CHECK 结果', () => {
    const h = indexHtml(list);
    for (const r of list) expect(h).toContain(`href="${r.id}.html"`);
  });
});
