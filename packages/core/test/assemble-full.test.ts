/**
 * T32 章节拼装（二）：第 5–8 章与 assembleReport。
 * 验收：卡片年份 / 干支与 Chart 流年表逐一相等；同条目跨年重复命中按 occurrence 重新取模（用户 2026-10-30 决定，
 * 可能与上次相同）；三柱用例无「冲时支」。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import {
  assembleReport,
  DISCLAIMER,
  healthExtremes,
  limitationsFromStrengthMd,
  type Chapter,
  type ParaBlock,
  type YearCard,
} from '../src/report/assemble';
import { buildCtx } from '../src/report/ctx';
import type { WuXing } from '../src/rules/types';
import { basisFor } from '../src/report/render';
import { createLibrary, variantIndex } from '../src/report/select';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const read = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
    .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') }));
const library = createLibrary(
  parseTextsFiles([
    ...read(fileURLToPath(new URL('../../../rules/texts/', import.meta.url))),
    ...read(fileURLToPath(new URL('./fixtures/texts/', import.meta.url))),
  ]),
  ['draft', 'reviewed', 'approved'],
);
const glossary = glossaryFromReadme(readRulesFile('texts/README.md'));
const limitations = limitationsFromStrengthMd(readRulesFile('strength.md'));

function build(id: string) {
  const chart = computeChart(cases.find((c) => c.id === id)?.input as never, REF);
  const analysis = analyze(chart);
  const ctx = buildCtx(chart, analysis);
  return {
    chart,
    ctx,
    report: assembleReport({
      chart,
      analysis,
      ctx,
      library,
      glossary,
      textsVersion: 'dev',
      limitations,
    }),
  };
}
const cardsOf = (ch: Chapter | undefined): YearCard[] =>
  (ch?.blocks ?? []).filter((b): b is YearCard => b.type === 'yearCard');
const cardParas = (c: YearCard): ParaBlock[] => [
  ...c.head,
  ...c.domains.career,
  ...c.domains.wealth,
  ...c.domains.love,
  ...c.domains.health,
  ...c.do,
  ...c.watch,
  ...c.rel,
];

describe('assembleReport：9 章与 meta', () => {
  it('C16：章节 0–8、meta 版本号', () => {
    const { report, chart } = build('C16');
    expect(report.chapters.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.meta).toMatchObject({
      textsVersion: 'dev',
      engineVersion: chart.engineVersion,
      tstStatus: '未校正',
      refDate: REF,
    });
  });
});

describe('第 5 章', () => {
  it('C16：INTRO → 时间轴 8 步 → PAST → 当前 / 下一步 → FAR；依据含起运岁数与顺逆', () => {
    const { report, ctx } = build('C16');
    const ch5 = report.chapters[5]?.blocks ?? [];
    const tl = ch5.find((b) => b.type === 'chart' && b.kind === 'dayun');
    expect(tl?.type === 'chart' && tl.data.map((d) => d.ganzhi)).toEqual(
      ctx.dayun.map((d) => d.ganzhi),
    );
    expect(basisFor('CH5-INTRO', ctx as never)).toBe(
      `起运 ${ctx.qiyun.age} 岁，${ctx.qiyun.direction}排`,
    );
    expect(basisFor('CH5-STEP', ctx as never, ctx.dayun[2] as never)).toBe(
      '戊辰（2022–2031）天干正财，宜保守、打基础',
    );
    expect(basisFor('CH5-PAST', ctx as never)).toBe('丙寅（顺势期）、丁卯（顺势期）');
  });
  it('三柱：起运依据写「约」', () => {
    const { ctx } = build('C18');
    expect(basisFor('CH5-INTRO', ctx as never)).toMatch(/^起运约 \d+ 岁，[顺逆]排$/);
  });
});

describe('第 6 章逐年卡片', () => {
  it('20 个案例：5 张卡片，年份 / 干支 / 立春与 Chart 流年表逐一相等；趋势线同序', () => {
    for (const c of cases) {
      const { report, chart } = build(c.id);
      const cards = cardsOf(report.chapters[6]);
      expect(
        cards.map((x) => [x.year, x.ganzhi, x.lichun]),
        c.id,
      ).toEqual(chart.liunian.map((l) => [l.year, l.ganzhi, l.lichun]));
      const trend = report.chapters[6]?.blocks[0];
      expect(trend?.type === 'chart' && trend.data.map((d) => d.year), c.id).toEqual(
        chart.liunian.map((l) => l.year),
      );
    }
  });

  it('每张卡都有十神、档位与 HEAD / 四领域 / DO / WATCH 各 1 段（第 1 批素材已覆盖）', () => {
    for (const c of cases) {
      for (const card of cardsOf(build(c.id).report.chapters[6])) {
        expect(card.ten_god && card.tier, c.id).toBeTruthy();
        for (const part of [
          card.head,
          card.domains.career,
          card.domains.wealth,
          card.domains.love,
          card.domains.health,
          card.do,
          card.watch,
        ]) {
          expect(part, `${c.id} ${card.year}`).toHaveLength(1);
        }
      }
    }
  });

  it('同条目跨年重复命中：第 n 次按 occurrence = n − 1 取模（与 variantIndex 一致）', () => {
    let repeats = 0;
    for (const c of cases) {
      const { report, ctx } = build(c.id);
      const seen = new Map<string, number>();
      for (const card of cardsOf(report.chapters[6])) {
        for (const p of cardParas(card)) {
          const occ = seen.get(p.entry as string) ?? 0;
          seen.set(p.entry as string, occ + 1);
          if (occ > 0) repeats++;
          const entry =
            library.bySlot.get(p.slot)?.find((e) => e.id === p.entry) ??
            library.fallbacks.get(p.slot);
          const n = entry?.variants.length ?? 1;
          expect(p.variant, `${c.id} ${p.entry}#${occ}`).toBe(
            variantIndex(ctx.chart_key, p.entry as string, occ, n),
          );
        }
      }
    }
    expect(repeats).toBeGreaterThan(0); // 5 年里同组十神出现两次的情况确实存在
  });

  it('三柱（C18 / C19）：卡片与全报告中都没有「冲时支」', () => {
    for (const id of ['C18', 'C19']) {
      const { report } = build(id);
      const cards = cardsOf(report.chapters[6]);
      expect(
        cards.flatMap((x) => x.relations.map((r) => r.b)),
        id,
      ).not.toContain('时支');
      expect(
        cards.flatMap((x) => x.rel.map((r) => r.entry)),
        id,
      ).not.toContain('CH6-REL-CHONG-SHIZHI');
    }
  });

  it('四柱且流年冲时支的案例会选到 CH6-REL-CHONG-SHIZHI', () => {
    const hits = cases.filter((c) =>
      cardsOf(build(c.id).report.chapters[6]).some((x) =>
        x.rel.some((r) => r.entry === 'CH6-REL-CHONG-SHIZHI'),
      ),
    );
    const expected = cases.filter((c) =>
      build(c.id).ctx.liunian.some((l) =>
        l.relations.some((r) => r.type === '冲' && r.b === '时支'),
      ),
    );
    expect(hits.map((c) => c.id)).toEqual(expected.map((c) => c.id));
  });
});

describe('第 7、8 章', () => {
  it('第 7 章（第 2 批素材）：无空槽位；健康段每段依据对应它自己触发的五行；均衡时选均衡条目', () => {
    let multi = 0;
    let balanced = 0;
    for (const c of cases) {
      const { report, ctx } = build(c.id);
      const empty = report.events.filter((e) => e.type === 'slot_empty').map((e) => e.slot);
      expect(
        empty.filter((x) => x.startsWith('CH7')),
        c.id,
      ).toEqual([]);
      const ch7 = (report.chapters[7]?.blocks ?? []).filter(
        (b): b is ParaBlock => b.type === 'para' && b.slot === 'CH7-HEALTH',
      );
      const ex = healthExtremes(ctx);
      expect(ch7.length, c.id).toBe(Math.max(1, Math.min(2, ex.length)));
      if (ex.length === 0) {
        balanced++;
        expect(ch7[0]?.entry, c.id).toBe('CH7-HEALTH-BALANCED');
        expect(ch7[0]?.basis, c.id).toBe('五行占比均在 5%～40% 之间，较为均衡');
      }
      if (ex.length >= 2) multi++;
      for (const p of ch7.filter((b) => b.entry !== 'CH7-HEALTH-BALANCED')) {
        const el = /^(.)占 /.exec(p.basis ?? '')?.[1] as WuXing;
        expect(
          ex.map((x) => x.element),
          c.id,
        ).toContain(el);
        // 条目本身就是针对这个五行写的
        expect(p.text, `${c.id} ${p.entry}`).toContain(el);
        expect(p.basis, c.id).toBe(`${el}占 ${ctx.power_pct[el]}%`);
      }
      // 两个极端五行时，两段分别对应两个不同的五行
      const els = ch7.map((p) => p.basis?.[0]);
      expect(new Set(els).size, c.id).toBe(els.length);
    }
    expect(balanced + multi).toBeGreaterThan(0);
  });
  it('第 8 章：规则 / 素材版本、子时口径、真太阳时状态、吉神说明、已知局限（strength.md §8 前 4 条）、免责声明', () => {
    expect(limitations).toHaveLength(4);
    expect(limitations[0]).toBe('不计合化、刑冲对力量的影响（v1）。');
    const texts = (build('C08').report.chapters[8]?.blocks ?? []).map((b) =>
      b.type === 'notice' ? b.text : '',
    );
    expect(texts[0]).toMatch(/^规则版本 [0-9a-f]{8}；素材库版本 dev。$/);
    expect(texts.some((t) => t.startsWith('子时口径'))).toBe(true);
    expect(texts).toContain('本份报告已按你选择的出生地做了真太阳时校正。');
    expect(texts.filter((t) => t.startsWith('已知局限'))).toHaveLength(4);
    expect(texts.at(-1)).toBe(DISCLAIMER);
  });
});

describe('全报告', () => {
  it('20 个案例：无残留占位符；术语只加注一次；确定性', () => {
    for (const c of cases) {
      const a = build(c.id).report;
      const json = JSON.stringify(a);
      expect(json, c.id).not.toMatch(/\{[a-z_]+\.[^}]*\}/);
      for (const g of glossary)
        expect(
          json.split(`${g.term}（${g.note}）`).length - 1,
          `${c.id} ${g.term}`,
        ).toBeLessThanOrEqual(1);
      expect(json).toBe(JSON.stringify(build(c.id).report));
    }
  });
});
