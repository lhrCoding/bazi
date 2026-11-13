/**
 * T33 R-CHECK 成品检查。
 * 验收：构造错误年份、冲突五行、超字数、含禁用词、重复段落样例都能被检出；合法样例通过。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import {
  assembleReport,
  limitationsFromStrengthMd,
  type Chapter,
  type ParaBlock,
  type Report,
  type YearCard,
} from '../src/report/assemble';
import { assertRCheck, CHAPTER_LENGTH, rcheck, type RCheckRule } from '../src/report/check';
import { buildCtx } from '../src/report/ctx';
import { createLibrary } from '../src/report/select';
import { parseForbiddenWordsFromMd, type Wordlists } from '../src/texts/lint';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const WORDS: Wordlists = {
  forbidden: parseForbiddenWordsFromMd(readRulesFile('report-sections.md')),
  disease: ['胃炎'],
  finance: ['基金'],
  whitelist: ['不一定', '一定的', '一定强度'],
};
const ctxOf = (id: string) => {
  const chart = computeChart(cases.find((c) => c.id === id)?.input as never, REF);
  const analysis = analyze(chart);
  return { chart, analysis, ctx: buildCtx(chart, analysis) };
};
const { ctx } = ctxOf('C16'); // 用火、喜木、忌土金

// ---------- 构造合法报告：正文用避开干支 / 五行 / 关键词 / 年 的字随机生成，段落彼此不相似 ----------
const BANNED = new Set([
  ...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥木火土金水喜用忌利节制年灾癌',
]);
const POOL = Array.from({ length: 0x5800 - 0x5000 }, (_, i) =>
  String.fromCharCode(0x5000 + i),
).filter((c) => !BANNED.has(c));
let seed = 1;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const text = (n: number): string =>
  Array.from({ length: n }, () => POOL[Math.floor(rnd() * POOL.length)]).join('');
const para = (slot: string, n: number): ParaBlock => ({
  type: 'para',
  slot,
  entry: `${slot}-X`,
  variant: 0,
  text: text(n),
  basis: '依据',
  polishable: false,
});
const card = (year: number, n: number): YearCard => ({
  type: 'yearCard',
  year,
  ganzhi: '丙午',
  lichun: '',
  ten_god: '伤官',
  tier: '向好',
  score: 1,
  relations: [],
  dayun: null,
  dayun_mark: null,
  basis: '',
  head: [para('CH6-HEAD', n)],
  domains: { career: [], wealth: [], love: [], health: [] },
  do: [],
  watch: [],
  rel: [],
});
function validReport(): Report {
  seed = 7;
  const mid = (id: number): number => {
    const r = CHAPTER_LENGTH[id] as readonly [number, number];
    return Math.round((r[0] + r[1]) / 2);
  };
  const ch = (id: number, slot: string, parts: number): Chapter => ({
    id,
    title: '',
    blocks: Array.from({ length: parts }, () => para(slot, Math.round(mid(id) / parts))),
  });
  return {
    meta: {
      textsVersion: 't',
      rulesVersion: 'r',
      engineVersion: 'e',
      tstStatus: '未校正',
      refDate: REF,
    },
    chapters: [
      { id: 0, title: '', blocks: [{ type: 'notice', kind: 'rules_version', text: '规则版本 x' }] },
      ch(1, 'CH1-DAYMASTER', 4),
      ch(2, 'CH2-METHOD', 5),
      ch(3, 'CH3-BASE', 5),
      ch(4, 'CH4-WHY', 3),
      ch(5, 'CH5-STEP', 5),
      { id: 6, title: '', blocks: ctx.liunian.map((l) => card(l.year, Math.round(mid(6) / 5))) },
      ch(7, 'CH7-CAREER', 5),
      { id: 8, title: '', blocks: [{ type: 'notice', kind: 'disclaimer', text: '免责' }] },
    ],
    events: [],
  };
}
const rules = (r: Report): RCheckRule[] => [
  ...new Set(rcheck(r, ctx, WORDS).failures.map((f) => f.rule)),
];
const firstPara = (r: Report, ch: number): ParaBlock => r.chapters[ch]?.blocks[0] as ParaBlock;

describe('合法样例', () => {
  it('构造的合法报告通过全部检查', () => {
    const r = rcheck(validReport(), ctx, WORDS);
    expect(r.failures).toEqual([]);
    expect(() => assertRCheck(r)).not.toThrow();
  });
  it('本命盘的年份、干支、与喜忌一致的五行措辞都合法', () => {
    const r = validReport();
    const p = firstPara(r, 2);
    p.text = `${p.text.slice(0, 60)}${ctx.liunian[0]?.year}年是${ctx.liunian[0]?.ganzhi}年，你喜木、火，需要节制的是土、金，不喜土也没关系。`;
    expect(rcheck(r, ctx, WORDS).failures).toEqual([]);
  });
  it('「火为用、木为喜、土宜节制」：顿号后的五行不算作前一个关键词的对象（第 1 批 CH2-METHOD 的写法）', () => {
    const r = validReport();
    firstPara(r, 2).text += '因此扶抑这一步的结论是：火为用、木为喜、土宜节制。';
    expect(rcheck(r, ctx, WORDS).failures).toEqual([]);
  });
});

describe('错误样例都能检出', () => {
  it('错误年份 / 陌生干支 → YEAR_GANZHI', () => {
    const r = validReport();
    firstPara(r, 1).text += '1888年';
    firstPara(r, 2).text += '甲子';
    const f = rcheck(r, ctx, WORDS).failures.filter((x) => x.rule === 'YEAR_GANZHI');
    expect(f.map((x) => x.message)).toEqual([
      '年份「1888年」不在本命盘的大运 / 流年中',
      '干支「甲子」不在本命盘的四柱 / 大运 / 流年中',
    ]);
    expect(f.map((x) => [x.chapter, x.slot])).toEqual([
      [1, 'CH1-DAYMASTER'],
      [2, 'CH2-METHOD'],
    ]);
  });
  it('冲突五行：把忌神写成有利、把用喜写成节制 → WUXING', () => {
    const r = validReport();
    firstPara(r, 2).text += '你喜土。';
    firstPara(r, 3).text += '要节制木、火。';
    const msgs = rcheck(r, ctx, WORDS)
      .failures.filter((x) => x.rule === 'WUXING')
      .map((x) => x.message);
    expect(msgs).toEqual([
      '「喜土」把忌神土写成有利',
      '「节制木、火」把用喜木写成需节制',
      '「节制木、火」把用喜火写成需节制',
    ]);
  });
  it('超字数 / 不足（章与全文）→ LENGTH', () => {
    const r = validReport();
    firstPara(r, 1).text += text(400);
    expect(rules(r)).toEqual(['LENGTH']);
    const short = validReport();
    short.chapters[6] = { id: 6, title: '', blocks: [] };
    const f = rcheck(short, ctx, WORDS).failures.map((x) => x.message);
    expect(f.some((m) => m.startsWith('第 6 章 0 字'))).toBe(true);
    expect(f.some((m) => m.startsWith('全文'))).toBe(true);
  });
  it('三柱：第 3 章下限 550、全文下限 4,800', () => {
    const three = ctxOf('C18').ctx;
    const r = validReport();
    (r.chapters[3] as Chapter).blocks = [para('CH3-BASE', 560)];
    const f = rcheck(
      r,
      { ...three, liunian: ctx.liunian, dayun: ctx.dayun },
      WORDS,
    ).failures.filter((x) => x.rule === 'LENGTH');
    expect(f.map((x) => x.chapter)).not.toContain(3);
    expect(
      rcheck(r, ctx, WORDS)
        .failures.filter((x) => x.rule === 'LENGTH')
        .map((x) => x.chapter),
    ).toContain(3);
  });
  it('禁用词 / 疾病名 / 金融产品词（含提示与表格）→ WORDS；白名单豁免', () => {
    const r = validReport();
    firstPara(r, 1).text += '这一年注定不同';
    firstPara(r, 7).text += '容易胃炎';
    (r.chapters[0] as Chapter).blocks.push({
      type: 'table',
      kind: 'advice',
      columns: ['a'],
      rows: [['可买基金']],
    });
    expect(
      rcheck(r, ctx, WORDS)
        .failures.filter((x) => x.rule === 'WORDS')
        .map((x) => x.message),
    ).toEqual(['命中金融产品词「基金」', '命中禁用词「注定」', '命中疾病名词「胃炎」']);
    const ok = validReport();
    firstPara(ok, 1).text += '不一定跟得上';
    expect(rcheck(ok, ctx, WORDS).failures).toEqual([]);
  });
  it('吉神禁用表述（shensha.md §4）→ WORDS', () => {
    const r = validReport();
    firstPara(r, 3).text += '你必有贵人相助，格外有力';
    expect(rcheck(r, ctx, WORDS).failures.map((x) => x.message)).toEqual([
      '命中吉神禁用表述「必有贵人」',
      '命中吉神禁用表述「格外有力」',
    ]);
  });
  it('重复段落（含跨年卡片）→ SIMILARITY', () => {
    const r = validReport();
    const a = firstPara(r, 2);
    const b = (r.chapters[2] as Chapter).blocks[1] as ParaBlock;
    b.text = a.text;
    const cards = (r.chapters[6] as Chapter).blocks as YearCard[];
    (cards[1] as YearCard).head[0] = { ...((cards[0] as YearCard).head[0] as ParaBlock) };
    const f = rcheck(r, ctx, WORDS).failures.filter((x) => x.rule === 'SIMILARITY');
    expect(f).toHaveLength(2);
    expect(f[0]?.message).toContain('相似度 1.00');
  });
  it('缺依据（第 1–3、7 章）/ 卡片缺十神 → BASIS；依据模板为「—」的槽位不要求', () => {
    const r = validReport();
    firstPara(r, 7).basis = null;
    ((r.chapters[6] as Chapter).blocks[0] as YearCard).tier = '';
    (r.chapters[1] as Chapter).blocks.push({ ...para('CH1-QUOTE', 0), basis: null, text: '' });
    const f = rcheck(r, ctx, WORDS).failures.filter((x) => x.rule === 'BASIS');
    expect(f.map((x) => x.slot)).toEqual(['CH6-HEAD', 'CH7-CAREER']);
  });
  it('assertRCheck 列出全部问题', () => {
    const r = validReport();
    firstPara(r, 1).text += '注定';
    expect(() => assertRCheck(rcheck(r, ctx, WORDS))).toThrow(/\[WORDS\]/);
  });
});

describe('真实素材 + 20 个案例（开发期）', () => {
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

  it('第 1 批素材：年份 / 干支、五行喜忌、禁用词三项全部通过（字数与相似度在素材齐全前不要求）', () => {
    const bad: string[] = [];
    for (const c of cases) {
      const x = ctxOf(c.id);
      const report = assembleReport({ ...x, library, glossary, textsVersion: 'dev', limitations });
      for (const f of rcheck(report, x.ctx, WORDS).failures) {
        if (['YEAR_GANZHI', 'WUXING', 'WORDS'].includes(f.rule))
          bad.push(`${c.id} [${f.rule}] ${f.slot} ${f.message}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
