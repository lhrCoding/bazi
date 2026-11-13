/**
 * T55 图一五行力量：数据完全来自报告 JSON（组件快照测试）。
 * 报告 JSON 由真实拼装得出；组件输出的每行五行、占比、十神组、角色、日主标记都必须与 JSON 一致，并锁定快照。
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '@zhiming/core';
import { assembleReport, buildCtx, type ChartBlock } from '@zhiming/core/report';
import { loadCases } from '../../../packages/core/test/helpers/cases';
import { PowerChart, type PowerRow } from '../app/power-chart';
import { BlockView } from '../app/r/[no]/blocks';
import { loadReportResources } from '../server/report-resources';
import { loadWorkspace } from '../server/texts-store';

const RULES = fileURLToPath(new URL('../../../rules', import.meta.url));
const lib = loadWorkspace(join(RULES, 'texts'), ['draft', 'reviewed', 'approved']).libraries.get(
  'dev',
)!;
const res = loadReportResources(RULES);
const REF = Date.parse('2026-11-13T10:00:00+08:00');
const { cases } = loadCases();

function report(id: string) {
  const c = cases.find((x) => x.id === id)!;
  const chart = computeChart(c.input, REF);
  const analysis = analyze(chart);
  return assembleReport({
    chart,
    analysis,
    ctx: buildCtx(chart, analysis),
    library: lib,
    glossary: res.glossary,
    textsVersion: 'dev',
    limitations: res.limitations,
  });
}
const powerBlock = (id: string) =>
  report(id).chapters[1]!.blocks.find(
    (b) => b.type === 'chart' && b.kind === 'power',
  ) as ChartBlock;

describe('图一 五行力量', () => {
  it('20 个案例：每行属性与报告 JSON 一致；恰好一个日主行；角色齐全', () => {
    for (const c of cases) {
      const b = powerBlock(c.id);
      const rows = b.data as unknown as PowerRow[];
      expect(
        rows.map((r) => r.element),
        c.id,
      ).toEqual(['木', '火', '土', '金', '水']);
      expect(
        rows.filter((r) => r.day),
        c.id,
      ).toHaveLength(1);
      expect(
        rows.filter((r) => r.role === '用'),
        c.id,
      ).toHaveLength(1);
      const html = renderToStaticMarkup(<PowerChart rows={rows} title="图一" />);
      for (const r of rows) {
        expect(html, c.id).toContain(
          `data-element="${r.element}" data-pct="${r.pct}" data-role="${r.role}" data-day="${r.day}"`,
        );
        expect(html, c.id).toContain(`>${r.pct}%<`);
        expect(html, c.id).toContain(`>${r.god}<`);
      }
      expect(b.caption, c.id).toMatch(
        /^红框为日主所在五行。.*比劫在正文中为 \d+%。同党（帮扶你的力量）占 \d+%，异党（消耗你的力量）占 \d+%。$/,
      );
    }
  });

  it('C16 快照（报告块整体渲染：图、图注）', () => {
    const html = renderToStaticMarkup(<BlockView b={powerBlock('C16')} />);
    expect(html).toMatchSnapshot();
  });

  it('免费页用法：无十神组 / 角色时不画标签', () => {
    const html = renderToStaticMarkup(
      <PowerChart
        title="五行强弱"
        rows={[
          { element: '木', pct: 31, day: true },
          { element: '火', pct: 0, day: false },
        ]}
      />,
    );
    expect(html).toContain('>日主<');
    expect(html).not.toContain('pc-tag');
    expect(html).toContain('>0%<');
  });
});

describe('第〇章吉神小表', () => {
  it('有吉神：表 + 固定灰字；无吉神：整块不显示（也不写「无」）', () => {
    let withJ = 0;
    let without = 0;
    for (const c of cases) {
      const chart = computeChart(c.input, REF);
      const has = analyze(chart).shensha.jishen_display.length > 0;
      const ch0 = report(c.id).chapters[0]!.blocks;
      const table = ch0.some((b) => b.type === 'table' && b.kind === 'shensha');
      const note = ch0.some((b) => b.type === 'notice' && b.kind === 'shensha_note');
      expect(table, c.id).toBe(has);
      expect(note, c.id).toBe(has);
      if (has) withJ++;
      else without++;
    }
    expect(withJ).toBeGreaterThan(0);
    expect(without + withJ).toBe(cases.length);
  });
});
