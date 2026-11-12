/**
 * T31 章节拼装（一）：第 0–4 章与代码模板。
 * 验收：用 fixture 素材拼出 C01、C12、C14、C04 的第 0–4 章，结构与顺序正确；三柱用例替换条目生效；
 * 吉神只出现在第 0、3 章。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import {
  ADVICE,
  altPossibility,
  assembleChapters0to4,
  JISHEN_NOTES,
  personaLine,
  summaryText,
  type Chapter,
  type ParaBlock,
} from '../src/report/assemble';
import { buildCtx } from '../src/report/ctx';
import { createLibrary } from '../src/report/select';
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

function build(id: string) {
  const chart = computeChart(cases.find((c) => c.id === id)?.input as never, REF);
  const analysis = analyze(chart);
  const ctx = buildCtx(chart, analysis);
  return {
    chart,
    analysis,
    ctx,
    ...assembleChapters0to4({ chart, analysis, ctx, library, glossary }),
  };
}
/** 每章的块序列：段落写槽位，其余写 type:kind */
const shape = (chs: Chapter[]) =>
  chs.map((c) =>
    c.blocks.map((b) =>
      b.type === 'para' ? b.slot : b.type === 'yearCard' ? 'yearCard' : `${b.type}:${b.kind}`,
    ),
  );
const paras = (c: Chapter) => c.blocks.filter((b): b is ParaBlock => b.type === 'para');

describe('C01 / C12 / C14 / C04：第 0–4 章结构与顺序', () => {
  for (const id of ['C01', 'C12', 'C14', 'C04']) {
    it(`${id} 结构快照`, () => {
      const r = build(id);
      expect(r.chapters.map((c) => [c.id, c.title])).toEqual([
        [0, '命盘总览'],
        [1, '你的日主与旺衰'],
        [2, '喜用神详解'],
        [3, '性格与天赋'],
        [4, '适合的行业 / 颜色 / 方位 / 数字'],
      ]);
      expect({ shape: shape(r.chapters), events: r.builder.events }).toMatchSnapshot();
    });
  }

  it('槽位顺序符合 report-sections.md §3 拼装顺序', () => {
    const s = shape(build('C12').chapters);
    expect(s[1]?.slice(0, 4)).toEqual(['CH1-DAYMASTER', 'CH1-MONTH', 'chart:power', 'CH1-BALANCE']);
    const ch2 = s[2] as string[];
    const order = [
      'CH2-METHOD',
      'CH2-SWAP',
      'CH2-SUMMARY',
      'CH2-ROLE-YONG',
      'CH2-ROLE-XI',
      'CH2-ROLE-JI',
    ];
    expect(ch2.filter((x) => order.includes(x))).toEqual(order); // C12 触发用神缺位互换
    expect(s[4]?.slice(0, 2)).toEqual(['table:advice', 'CH4-WHY']);
    expect(s[4]?.filter((x) => x === 'CH4-ELEMENT')).toHaveLength(2);
  });

  it('C14 从财：METHOD 选从财条目；C01 冬季调候一致；C04 无调候 / 互换', () => {
    const entryOf = (id: string, slot: string) =>
      build(id)
        .chapters.flatMap(paras)
        .find((p) => p.slot === slot)?.entry;
    expect(entryOf('C14', 'CH2-METHOD')).toBe('CH2-METHOD-CONG-CAI');
    expect(entryOf('C01', 'CH2-TIAOHOU')).toBe('CH2-TIAOHOU-AGREE-WINTER');
    expect(entryOf('C04', 'CH2-TIAOHOU')).toBeUndefined();
    expect(entryOf('C12', 'CH2-SWAP')).toBe('CH2-SWAP-GENERIC');
  });

  it('第 1、2 章的必需槽位不落兜底（第 1 批素材已覆盖）；第 3、4 章使用 fixture 兜底', () => {
    for (const id of ['C01', 'C12', 'C14', 'C04']) {
      const fb = build(id)
        .builder.events.filter((e) => e.type === 'fallback_used')
        .map((e) => e.slot);
      expect(
        fb.filter((s) => s.startsWith('CH1') || s.startsWith('CH2')),
        id,
      ).toEqual([]);
    }
  });
});

describe('代码模板', () => {
  it('第 0 章命盘表、未校正灰字、规则版本；第 2 章 SUMMARY；第 3 章画像；第 4 章建议表', () => {
    const r = build('C16');
    const ch0 = r.chapters[0]?.blocks ?? [];
    const table = ch0.find((b) => b.type === 'table' && b.kind === 'chart');
    expect(table).toMatchObject({
      rows: [
        ['干支', '癸酉', '乙丑', '乙未', '己卯'],
        ['天干十神', '偏印', '比肩', '日主', '偏财'],
        expect.anything(),
      ],
    });
    expect(
      ch0.some(
        (b) => b.type === 'notice' && b.kind === 'tst' && b.text.startsWith('时辰按北京时间排定'),
      ),
    ).toBe(true);
    expect(ch0.at(-1)).toMatchObject({ type: 'notice', kind: 'rules_version' });
    expect(summaryText(r.ctx)).toBe(
      '综合以上，你的用神是火，喜神是木，需要节制的是土、金，水为闲神。',
    );
    expect(personaLine(r.ctx)).toBe('花草藤蔓：独立、灵活，状态均衡、懂得借力。');
    const adv = r.chapters[4]?.blocks[0];
    expect(adv).toMatchObject({ type: 'table', kind: 'advice' });
    expect(adv?.type === 'table' && adv.rows.map((x) => x[0])).toEqual(['用神：火', '喜神：木']);
    expect(adv?.type === 'table' && adv.rows[0]?.[1]).toBe(ADVICE['火'].color);
  });

  it('SUMMARY：闲神为空时省略该句（C15 专旺）', () => {
    expect(summaryText(build('C15').ctx)).toBe(
      '综合以上，你的用神是木，喜神是水、火，需要节制的是金、土。',
    );
  });

  it('选了出生地（C08 乌鲁木齐）：真太阳时说明代替未校正灰字', () => {
    const tst = build('C08').chapters[0]?.blocks.find(
      (b) => b.type === 'notice' && b.kind === 'tst',
    );
    expect(tst?.type === 'notice' && tst.text).toMatch(
      /^北京时间 00:40 → 真太阳时 22:\d\d（经度修正 −\d+ 分、均时差 [+−]\d+ 分）$/,
    );
  });
});

describe('三柱（C18 高置信、C19 低置信交节）', () => {
  it('第 0 章三柱缺失说明（含置信度）、无真太阳时灰字；命盘表时柱为「未知」', () => {
    for (const [id, conf] of [
      ['C18', '高'],
      ['C19', '低'],
    ] as const) {
      const ch0 = build(id).chapters[0]?.blocks ?? [];
      expect(ch0[0]).toMatchObject({ type: 'notice', kind: 'nohour' });
      expect(ch0[0]?.type === 'notice' && ch0[0].text).toContain(`可信度为「${conf}」`);
      expect(ch0.some((b) => b.type === 'notice' && b.kind === 'tst')).toBe(false);
      const t = ch0.find((b) => b.type === 'table' && b.kind === 'chart');
      expect(t?.type === 'table' && t.rows.map((r) => r[4])).toEqual(['未知', '未知', '未知']);
    }
  });

  it('替换条目：CH1-CONCLUSION 用三柱条目；C19 置信低 → METHOD 用「仅供参考」条目、SUMMARY 加提示、另一种可能句、第 4 章前置提示', () => {
    const c18 = build('C18').chapters.flatMap(paras);
    expect(c18.find((p) => p.slot === 'CH1-CONCLUSION')?.entry).toMatch(/^CH1-CONCLUSION-NOHOUR-/);
    const r = build('C19');
    const p = r.chapters.flatMap(paras);
    expect(p.find((x) => x.slot === 'CH1-CONCLUSION')?.entry).toMatch(
      /^CH1-CONCLUSION-NOHOUR-.*-DI$/,
    );
    expect(p.find((x) => x.slot === 'CH2-METHOD')?.entry).toMatch(/^CH2-METHOD-LOW-/);
    expect(p.find((x) => x.slot === 'CH2-SUMMARY')?.text).toContain('仅供参考');
    const ch1 = r.chapters[1]?.blocks ?? [];
    const altIdx = ch1.findIndex((b) => b.type === 'notice' && b.kind === 'alt_possibility');
    const balIdx = ch1.findIndex((b) => b.type === 'para' && b.slot === 'CH1-BALANCE');
    expect(altIdx).toBe(balIdx + 1);
    expect(altPossibility(r.analysis)).toBe(
      '另一种可能：若出生在当天交节之后（年月柱为甲辰、丙寅），结论会偏向身旺，用神为水。',
    );
    expect(r.chapters[4]?.blocks[1]).toMatchObject({ type: 'notice', kind: 'advice_premise' });
  });

  it('C18 扫描有从格时辰 → CH2-NOHOUR-CONG 出现；四柱案例不出现', () => {
    expect(
      build('C18')
        .chapters.flatMap(paras)
        .some((p) => p.slot === 'CH2-NOHOUR-CONG'),
    ).toBe(true);
    expect(
      build('C16')
        .chapters.flatMap(paras)
        .some((p) => p.slot === 'CH2-NOHOUR-CONG'),
    ).toBe(false);
  });
});

describe('吉神只出现在第 0、3 章；引文与加注', () => {
  it('20 个案例：吉神名只出现在第 0 章小表 / 灰字与第 3 章 CH3-SHENSHA', () => {
    const names = Object.keys(JISHEN_NOTES);
    for (const c of cases) {
      const r = build(c.id);
      for (const ch of r.chapters) {
        const json = JSON.stringify(
          ch.blocks.filter((b) => !(b.type === 'para' && b.slot === 'CH3-SHENSHA')),
        );
        const hit = names.filter((n) => json.includes(n));
        if (ch.id !== 0) expect(hit, `${c.id} 第 ${ch.id} 章`).toEqual([]);
      }
      const hasJs = r.analysis.shensha.jishen_display.length > 0;
      expect(
        r.chapters[0]?.blocks.some((b) => b.type === 'table' && b.kind === 'shensha'),
        c.id,
      ).toBe(hasJs);
      expect(
        r.chapters[3]?.blocks.some((b) => b.type === 'para' && b.slot === 'CH3-SHENSHA'),
        c.id,
      ).toBe(hasJs);
    }
  });

  it('引文：一章 ≤ 1 句；术语全报告只加注一次；所有段落无残留占位符', () => {
    for (const c of cases) {
      const r = build(c.id);
      for (const ch of r.chapters)
        expect(paras(ch).filter((p) => p.quote).length, `${c.id}-${ch.id}`).toBeLessThanOrEqual(1);
      const text = r.chapters
        .flatMap(paras)
        .map((p) => p.text)
        .join('\n');
      expect(text, c.id).not.toMatch(/[{}]/);
      for (const g of glossary) {
        expect(
          text.split(`${g.term}（${g.note}）`).length - 1,
          `${c.id} ${g.term}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('确定性：同一案例两次拼装逐字相同', () => {
    expect(JSON.stringify(build('C12').chapters)).toBe(JSON.stringify(build('C12').chapters));
  });
});

describe('图1 五行力量', () => {
  it('百分比为整数（T37 预览发现此前输出未取整的浮点数）', () => {
    for (const c of cases) {
      const ch1 = build(c.id).chapters[1]?.blocks ?? [];
      const chart = ch1.find((b) => b.type === 'chart' && b.kind === 'power');
      expect(
        chart?.type === 'chart' && chart.data.every((d) => Number.isInteger(d.pct)),
        c.id,
      ).toBe(true);
    }
  });
});
