/**
 * T56 逐年卡片补充字段与图二数据：所在大运、换运年 / 最后一年标注、依据行；大运天干十神。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import { assembleReport, limitationsFromStrengthMd, type YearCard } from '../src/report/assemble';
import { buildCtx } from '../src/report/ctx';
import { createLibrary } from '../src/report/select';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const library = createLibrary(
  parseTextsFiles(
    readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
      .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
  ),
  ['draft', 'reviewed', 'approved'],
);
const glossary = glossaryFromReadme(readRulesFile('texts/README.md'));
const limitations = limitationsFromStrengthMd(readRulesFile('strength.md'));

describe('逐年卡片 / 图二', () => {
  it('20 个案例：所在大运与 ctx 一致；标注规则；依据行格式；大运十神', () => {
    let marks = 0;
    for (const c of loadCases().cases) {
      const chart = computeChart(c.input, REF);
      const analysis = analyze(chart);
      const ctx = buildCtx(chart, analysis);
      const rep = assembleReport({
        chart,
        analysis,
        ctx,
        library,
        glossary,
        textsVersion: 't',
        limitations,
      });
      const cards = (rep.chapters[6]?.blocks ?? []).filter(
        (b): b is YearCard => b.type === 'yearCard',
      );
      expect(cards).toHaveLength(5);
      cards.forEach((card, i) => {
        const l = ctx.liunian[i];
        if (!l) throw new Error(`${c.id} 缺流年 ${i}`);
        expect(card.dayun, c.id).toBe(l.dayun);
        const starts = ctx.dayun.some((d) => d.start_year === card.year);
        const ends = ctx.dayun.some((d) => d.ganzhi === l.dayun && d.end_year === card.year);
        expect(card.dayun_mark, c.id).toBe(starts ? '新一步第一年' : ends ? '最后一年' : null);
        if (card.dayun_mark) marks++;
        expect(card.basis, c.id).toMatch(
          new RegExp(
            `^流年天干${l.ganzhi[0]}为${l.stem_ten_god}；(.+；)?评分 [+−]\\d\\.\\d\\d，落在「${l.tier}」区间$`,
          ),
        );
        expect(card.basis.includes('（'), c.id).toBe(l.relations.length > 0);
        // 三柱：不出现时支
        if (!chart.hourKnown) expect(card.basis, c.id).not.toContain('时支');
      });
      const dy = (rep.chapters[5]?.blocks ?? []).find(
        (b) => b.type === 'chart' && b.kind === 'dayun',
      );
      expect(dy && dy.type === 'chart' ? dy.data.map((d) => d.ten_god) : [], c.id).toEqual(
        ctx.dayun.map((d) => d.stem_ten_god),
      );
    }
    expect(marks).toBeGreaterThan(0);
  });
});
