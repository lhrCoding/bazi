/**
 * T35 动态覆盖率 + 字数分布（report-sections.md §5.1 第 3 条）。
 * 验收：输出四项指标；故意写一条 asserts 与 when 不一致的 fixture 素材时被报出；随机种子固定、结果可复现；
 * 运行时间 < 3 分钟（完整 10,000 样本由 npm run texts:sample 运行，本测试用小样本）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import { limitationsFromStrengthMd } from '../src/report/assemble';
import { buildCtx } from '../src/report/ctx';
import { randomBirthInputs, runSample, type SampleOptions } from '../src/report/sample';
import { createLibrary } from '../src/report/select';
import { parseForbiddenWordsFromMd } from '../src/texts/lint';
import type { TextEntry } from '../src/texts/schema';
import { glossaryFromReadme, parseTextsFiles } from '../src/texts/yaml';
import { readRulesFile } from './helpers/fixtures';

const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const entries = parseTextsFiles(
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
    .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
);
const REF = Date.parse('2026-10-30T00:00:00+08:00');
const opts = (es: readonly TextEntry[]): SampleOptions => ({
  library: createLibrary(es, ['draft', 'reviewed', 'approved']),
  glossary: glossaryFromReadme(readRulesFile('texts/README.md')),
  words: {
    forbidden: parseForbiddenWordsFromMd(readRulesFile('report-sections.md')),
    disease: [],
    finance: [],
    whitelist: ['不一定', '一定的', '一定强度'],
  },
  limitations: limitationsFromStrengthMd(readRulesFile('strength.md')),
  textsVersion: 'dev',
  refDateMs: REF,
});

describe('随机出生信息', () => {
  it('种子固定可复现；范围 1940–2030；男女交替；约 10% 无时辰', () => {
    const a = randomBirthInputs(2000, 42);
    expect(randomBirthInputs(2000, 42)).toEqual(a);
    expect(randomBirthInputs(2000, 43)).not.toEqual(a);
    const years = a.map((x) => Number(x.date.slice(0, 4)));
    expect(Math.min(...years)).toBeGreaterThanOrEqual(1940);
    expect(Math.max(...years)).toBeLessThanOrEqual(2030);
    expect(a.filter((x) => x.gender === '男')).toHaveLength(1000);
    const noHour = a.filter((x) => x.time === null).length / a.length;
    expect(noHour).toBeGreaterThan(0.07);
    expect(noHour).toBeLessThan(0.13);
    expect(a.every((x) => x.time === null || /^\d{2}:\d{2}$/.test(x.time))).toBe(true);
  });
});

describe('四项指标（小样本）', () => {
  const inputs = randomBirthInputs(150, 20261112);
  const m = runSample(inputs, opts(entries));

  it('输出四项指标且可复现', () => {
    expect(m.samples).toBe(150);
    expect(m).toHaveProperty('fallbackUsed');
    expect(m).toHaveProperty('lengthPassRate');
    expect(m).toHaveProperty('rcheckFailedReports');
    expect(m).toHaveProperty('assertDefects');
    expect(runSample(inputs, opts(entries))).toEqual(m);
  });

  it('第 1 批素材：第 1、2、6 章不落兜底、无 asserts 缺陷；禁用词零命中（含术语释义）', () => {
    expect(Object.keys(m.fallbackUsed).filter((s) => /^CH[126]-/.test(s))).toEqual([]);
    expect(Object.keys(m.slotEmpty).filter((s) => /^CH[126]-/.test(s))).toEqual([]);
    expect(m.assertDefects).toEqual([]);
    expect(m.rcheckFailedReports.WORDS ?? 0).toBe(0);
    expect(m.rcheckFailedReports.YEAR_GANZHI ?? 0).toBe(0);
    expect(m.rcheckFailedReports.WUXING ?? 0).toBe(0);
  });

  it('故意写一条 asserts 与 when 不一致的素材 → 报为缺陷，并给出首次出现的样本', () => {
    const bad: TextEntry = {
      ...(entries.find((e) => e.id === 'CH1-DAYMASTER-JIA') as TextEntry),
      id: 'CH1-DAYMASTER-BAD',
      when: { f: 'day.element', eq: '木' },
      asserts: [{ f: 'day.stem', eq: '甲' }], // 乙木日主时 when 成立而 asserts 不成立
    };
    const r = runSample(inputs, opts([...entries, bad]));
    expect(r.assertDefects.map((d) => [d.entry, d.slot])).toEqual([
      ['CH1-DAYMASTER-BAD', 'CH1-DAYMASTER'],
    ]);
    const first = inputs[r.assertDefects[0]?.firstSample ?? -1];
    const chart = computeChart(first as never, REF);
    expect(chart.pillars.day[0]).toBe('乙');
  });

  it('keepLengths 时给出逐章字数（第 1–7 章）与全文', () => {
    const r = runSample(inputs.slice(0, 3), opts(entries), true);
    expect(r.lengths).toHaveLength(3);
    expect(Object.keys(r.lengths?.[0]?.chapters ?? {})).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });
});

describe('回归：ctx 的「最强组」与规则引擎同口径（T35 发现的并列边界）', () => {
  const tie = [
    {
      date: '1948-04-26',
      time: '16:59',
      gender: '女',
      fy: 'Y-FY-W-SHA',
      key: 'top_yidang',
      want: '官杀',
    },
    {
      date: '1953-07-03',
      time: '07:53',
      gender: '女',
      fy: 'Y-FY-W-SHI',
      key: 'top_yidang',
      want: '食伤',
    },
    {
      date: '1951-05-12',
      time: '01:20',
      gender: '男',
      fy: 'Y-FY-S-BI-SHI',
      key: 'top_tongdang',
      want: '比劫',
    },
  ] as const;
  for (const t of tie) {
    it(`${t.date} ${t.time}：${t.fy} ⇒ ${t.key} = ${t.want}`, () => {
      const chart = computeChart(
        {
          calendar: 'solar',
          date: t.date,
          time: t.time,
          gender: t.gender,
          placeCode: null,
          jieqiChoice: null,
        },
        REF,
      );
      const ctx = buildCtx(chart, analyze(chart));
      expect(ctx.yongshen.fy_rule).toBe(t.fy);
      expect(ctx.gods[t.key]).toBe(t.want);
    });
  }
});
