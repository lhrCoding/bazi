/**
 * T30 占位符替换、术语首次加注、依据。
 * 验收：每种占位符用例；术语只加注一次；引文和表格内不加注；依据中的数值与 ctx 一致。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import { buildCtx } from '../src/report/ctx';
import { Annotator, basisFor, renderText, RenderError } from '../src/report/render';
import { createLibrary, selectSlot, VariantChooser } from '../src/report/select';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const ctxOf = (id: string) => {
  const chart = computeChart(cases.find((c) => c.id === id)?.input as never, REF);
  return buildCtx(chart, analyze(chart)) as unknown as Record<string, unknown> &
    ReturnType<typeof buildCtx>;
};
const C16 = ctxOf('C16');
const GLOSSARY = glossaryFromReadme(readRulesFile('texts/README.md'));

describe('占位符', () => {
  it('标量、整数百分比、列表「、」连接、|名、item.*', () => {
    expect(renderText('日主{day.stem}{day.element}', C16)).toBe('日主乙木');
    expect(renderText('财星占 {gods.财_pct}%', C16)).toBe('财星占 41%');
    expect(renderText('忌{yongshen.ji}', C16)).toBe('忌土、金');
    expect(renderText('{gods.top_yidang|名}最强，其次{yongshen.yong_god|名}', C16)).toBe(
      '财星最强，其次食伤',
    );
    expect(renderText('{el.印}是印星的五行', C16)).toBe('水是印星的五行');
    expect(renderText('{item.year}年是{item.ganzhi}年', C16, { year: 2026, ganzhi: '丙午' })).toBe(
      '2026年是丙午年',
    );
    expect(renderText('没有占位符', C16)).toBe('没有占位符');
  });
  it('无法解析的占位符抛错（null、不存在、空列表、对象、未知过滤器、|名 用错）', () => {
    const three = ctxOf('C18');
    expect(() => renderText('{ten_gods.hour_stem}', three)).toThrow(RenderError);
    expect(() => renderText('{no.such}', C16)).toThrow(RenderError);
    expect(() => renderText('{x.list}', { x: { list: [] } })).toThrow(RenderError);
    expect(() => renderText('{day}', C16)).toThrow(RenderError);
    expect(() => renderText('{day.stem|简}', C16)).toThrow(/未知过滤器/);
    expect(() => renderText('{day.stem|名}', C16)).toThrow(/只能用于十神组/);
    expect(() => renderText('{x.n}', { x: { n: 41.2 } })).toThrow(/不是整数/);
  });
});

describe('术语首次加注', () => {
  const g = [
    { term: '七杀', note: '较强的压力' },
    { term: '官杀', note: '规则与压力' },
    { term: '日主', note: '你自己' },
    { term: '用神', note: '最有帮助的五行' },
  ];
  it('整份报告每个术语只加注一次（跨段落共用一个 Annotator）', () => {
    const a = new Annotator(g);
    expect(a.annotate('你的日主是乙木，日主偏弱。')).toBe('你的日主（你自己）是乙木，日主偏弱。');
    expect(a.annotate('日主需要帮扶，用神是火。')).toBe(
      '日主需要帮扶，用神（最有帮助的五行）是火。',
    );
    expect([...a.annotated].sort()).toEqual(['日主', '用神'].sort());
  });
  it('最长优先：不在长术语内部再匹配短术语', () => {
    const a = new Annotator([...g, { term: '日主五行', note: '日干的五行' }]);
    expect(a.annotate('日主五行是木，日主很稳')).toBe(
      '日主五行（日干的五行）是木，日主（你自己）很稳',
    );
  });
  it('引号、括号内不加注，也不消耗「首次」', () => {
    const a = new Annotator(g);
    expect(a.annotate('古人说“七杀有制”，「七杀」也叫偏官（七杀）。七杀是压力')).toBe(
      '古人说“七杀有制”，「七杀」也叫偏官（七杀）。七杀（较强的压力）是压力',
    );
  });
  it('表格 / 卡片标题 / 古籍原文（annotatable = false）原样输出且不消耗「首次」', () => {
    const a = new Annotator(g);
    expect(a.annotate('七杀 | 官杀', false)).toBe('七杀 | 官杀');
    expect(a.annotate('官杀重')).toBe('官杀（规则与压力）重');
  });
  it('README §8 示例术语表可直接使用', () => {
    const a = new Annotator(GLOSSARY);
    expect(a.annotate('你的用神是火，喜神是木')).toBe(
      '你的用神（对你最有帮助的五行）是火，喜神（次一级、同样有利的五行）是木',
    );
  });
});

describe('依据：数值与 ctx 一致', () => {
  it('C16 第 1–4、7 章', () => {
    const c = C16;
    expect(basisFor('CH1-DAYMASTER', c)).toBe('日主乙木');
    expect(basisFor('CH1-MONTH', c)).toBe('生于丑月，月令本气己为财星');
    expect(basisFor('CH1-BALANCE', c)).toBe(
      `同党 ${c.strength.S_pct}%（比劫 ${c.gods['比劫_pct']}%、印星 ${c.gods['印_pct']}%）；异党最强 财星`,
    );
    expect(basisFor('CH1-CONCLUSION', c)).toBe('规则 S-LEVEL：中和偏弱');
    expect(basisFor('CH2-METHOD', c)).toBe('规则 Y-FY-W-CAI');
    expect(basisFor('CH2-TIAOHOU', c)).toBe('规则 Y-TH-NEUTRAL-OVERRIDE');
    expect(basisFor('CH2-ROLE-YONG', c)).toBe(`火是你的食伤，占 ${c.gods['食伤_pct']}%`);
    expect(basisFor('CH2-ROLE-JI', c)).toBe(`土是你的财星，占 ${c.gods['财_pct']}%`);
    expect(basisFor('CH3-STYLE', c)).toBe(`同党 ${c.strength.S_pct}%`);
    expect(basisFor('CH3-TALENT', c)).toBe(`最强十神组 财星 ${c.gods['财_pct']}%`);
    expect(basisFor('CH3-GOD', c, { pos: '月干', ten_god: '比肩', god: '比劫' })).toBe(
      `月干比肩，比劫占 ${c.gods['比劫_pct']}%`,
    );
    expect(basisFor('CH4-WHY', c)).toBe('用神 火、喜神 木');
    expect(basisFor('CH7-CAREER', c)).toMatch(
      new RegExp(`为(用神|喜神)，占 \\d+%；当前大运天干正财$`),
    );
    expect(basisFor('CH7-WEALTH', c)).toBe(`财星 ${c.gods['财_pct']}%，为忌神`);
    expect(basisFor('CH7-LOVE', c)).toBe(`伴侣星 ${c.partner.pct}%，为忌神；日支偏财`);
    expect(basisFor('CH7-LOVE-YEARS', c)).toBe('2026合日支');
    expect(basisFor('CH7-HEALTH', c, { element: '土' })).toBe(`土占 ${c.power_pct['土']}%`);
  });
  it('依据中出现的百分比都等于 ctx 中对应字段', () => {
    const s = basisFor('CH1-BALANCE', C16) ?? '';
    const nums = [...s.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    expect(nums).toEqual([C16.strength.S_pct, C16.gods['比劫_pct'], C16.gods['印_pct']]);
  });
  it('「—」与第 6 章无依据；三柱从格提示列出时支', () => {
    expect(basisFor('CH1-QUOTE', C16)).toBeNull();
    expect(basisFor('CH6-HEAD', C16)).toBeNull();
    expect(basisFor('CH4-NOTE', C16)).toBeNull();
    expect(basisFor('CH2-NOHOUR-CONG', ctxOf('C18'))).toBe('若生于巳时、戌时可能符合从格条件');
  });
});

describe('真实素材渲染（C16，开发期允许 draft）', () => {
  const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
  const lib = createLibrary(
    parseTextsFiles(
      readdirSync(dir)
        .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
        .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
    ),
    ['draft', 'reviewed', 'approved'],
  );
  it('第 1 章四个必需槽位：占位符全部替换、无残留花括号、首个术语加注一次', () => {
    const ch = new VariantChooser(C16.chart_key);
    const ann = new Annotator(GLOSSARY);
    const paras = ['CH1-DAYMASTER', 'CH1-MONTH', 'CH1-BALANCE', 'CH1-CONCLUSION'].map((s) => {
      const p = selectSlot(lib, s, C16, 1);
      const chosen = ch.choose(p.entries[0] as never);
      return ann.annotate(renderText(chosen.text, C16));
    });
    for (const t of paras) expect(t).not.toMatch(/[{}]/);
    const all = paras.join('');
    for (const term of ann.annotated) {
      const note = GLOSSARY.find((g) => g.term === term)?.note ?? '';
      expect(all.split(`${term}（${note}）`).length - 1, term).toBe(1);
    }
    expect(all).toContain(String(C16.gods['财_pct']));
  });
});
