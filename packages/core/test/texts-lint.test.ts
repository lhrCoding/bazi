/**
 * T24 素材 lint L1–L6（rules/texts/README.md §7）。
 * 验收：每条规则一个违规样例 + 一个合规样例；rules/texts 实际素材 lint 结果与预期一致（当前 0 个问题，
 * 引文 verified: false 在 draft 状态下不报错）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  lintEntries,
  parseForbiddenWordsFromMd,
  type LintIssue,
  type LintRule,
  type Wordlists,
} from '../src/texts/lint';
import type { TextEntry } from '../src/texts/schema';
import { parseTextsFiles } from '../src/texts/yaml';
import { readRulesFile } from './helpers/fixtures';

const FORBIDDEN = parseForbiddenWordsFromMd(readRulesFile('report-sections.md'));
const WORDS: Wordlists = {
  forbidden: FORBIDDEN,
  disease: ['胃炎'],
  finance: ['基金'],
  whitelist: [],
};

/** 合规基准：CH1-DAYMASTER（必需，维度 day.stem，非循环） */
function entry(over: Partial<TextEntry> = {}): TextEntry {
  return {
    id: 'CH1-DAYMASTER-JIA',
    slot: 'CH1-DAYMASTER',
    when: { all: [{ f: 'day.stem', eq: '甲' }] },
    asserts: [],
    priority: 50,
    fallback: false,
    requires_hour: false,
    length: [120, 180],
    variants: ['你的日主是{day.stem}{day.element}，像一棵向上生长的树。', '第二个变体，写法不同。'],
    status: 'draft',
    author: 'mingli-expert',
    reviewer: null,
    updated: '2026-11-11',
    ...over,
  };
}
const lint = (e: TextEntry, w: Wordlists = WORDS): LintIssue[] => lintEntries([e], w);
const rules = (e: TextEntry, w?: Wordlists): LintRule[] => lint(e, w).map((i) => i.rule);

describe('合规基准', () => {
  it('基准条目无问题', () => expect(lint(entry())).toEqual([]));
});

describe('L1 槽位', () => {
  it('违规：槽位不存在 / 代码模板槽位', () => {
    expect(lint(entry({ slot: 'CH1-NOPE' }))).toEqual([
      { id: 'CH1-DAYMASTER-JIA', rule: 'L1', message: '槽位 CH1-NOPE 不在 report-sections.md §3' },
    ]);
    expect(
      rules(entry({ id: 'CH2-SUMMARY-X', slot: 'CH2-SUMMARY', when: {}, fallback: true })),
    ).toContain('L1');
  });
  it('违规：id 不符合正则', () => expect(rules(entry({ id: 'ch1-x' }))).toContain('L1'));
  it('合规：固定文本槽位与 FREE- 前缀', () => {
    expect(
      lint(entry({ id: 'CH4-NOTE-FIXED', slot: 'CH4-NOTE', when: {}, variants: ['固定文本'] })),
    ).toEqual([]);
  });
});

describe('L2 when / asserts 字段', () => {
  it('违规：字段不在字典', () => {
    expect(lint(entry({ when: { f: 'day.stemm', eq: '甲' } })).map((i) => i.message)).toEqual([
      'when：字段 day.stemm 不在字段字典（README §3）',
      'when 引用了 day.stemm；必需槽位 CH1-DAYMASTER 只允许 day.stem',
    ]);
  });
  it('违规：必需槽位引用维度外字段', () => {
    const m = lint(
      entry({
        when: {
          all: [
            { f: 'day.stem', eq: '甲' },
            { f: 'strength.level', eq: '身弱' },
          ],
        },
      }),
    );
    expect(m.map((i) => i.rule)).toEqual(['L2']);
    expect(m[0]?.message).toContain('strength.level');
  });
  it('合规：修饰字段可用；asserts 不受维度限制', () => {
    const e = entry({
      id: 'CH1-CONCLUSION-X',
      slot: 'CH1-CONCLUSION',
      when: {
        all: [
          { f: 'strength.level', eq: '身弱' },
          { f: 'profile.time_known', eq: false },
        ],
      },
      asserts: [{ f: 'yongshen.yong', eq: '火' }],
    });
    expect(lint(e)).toEqual([]);
  });
  it('违规：非循环槽位引用 item.*；循环槽位合规', () => {
    expect(
      rules(entry({ id: 'CH1-QUOTE-X', slot: 'CH1-QUOTE', when: { f: 'item.tier', eq: '向好' } })),
    ).toEqual(['L2']);
    const loop = entry({
      id: 'CH6-HEAD-X',
      slot: 'CH6-HEAD',
      when: {
        all: [
          { f: 'item.stem_ten_god', eq: '七杀' },
          { f: 'item.tier', eq: '向好' },
        ],
      },
    });
    expect(lint(loop)).toEqual([]);
  });
  it('违规：取值不在域内 / 运算符与类型不符 / 文本字段作条件', () => {
    expect(lint(entry({ when: { f: 'day.stem', eq: '子' } }))[0]?.message).toContain('不在域内');
    expect(lint(entry({ when: { f: 'day.stem', gte: 1 } }))[0]?.message).toContain('不能用 gte');
    const q = (when: TextEntry['when']) => entry({ id: 'CH1-QUOTE-X', slot: 'CH1-QUOTE', when });
    expect(lint(q({ f: 'yongshen.ji', eq: '火' }))[0]?.message).toContain('contains');
    expect(lint(q({ f: 'strength.borderline', eq: '是' }))[0]?.message).toContain('true / false');
    expect(lint(q({ f: 'strength.S_pct', gte: 40 }))).toEqual([]);
    expect(
      lint(entry({ id: 'CH6-HEAD-X', slot: 'CH6-HEAD', when: { f: 'item.ganzhi', eq: '甲子' } }))[0]
        ?.message,
    ).toContain('只能用于占位符');
  });
  it('违规：{} 只允许兜底；兜底条目 when 必须为 {}', () => {
    expect(lint(entry({ when: {} }))[0]?.message).toContain('只允许兜底');
    expect(lint(entry({ fallback: true }))[0]?.message).toContain('兜底条目的 when 应为 {}');
    expect(lint(entry({ when: {}, fallback: true, priority: 0 }))).toEqual([]);
  });
  it('违规：嵌套深度超过 3', () => {
    const deep = {
      all: [{ all: [{ all: [{ all: [{ f: 'day.stem', eq: '甲' }] }] }] }],
    } as TextEntry['when'];
    expect(lint(entry({ when: deep }))[0]?.message).toContain('深度');
  });
});

describe('L3 占位符', () => {
  it('违规：字段不存在 / 未知过滤器 / |名 用在非十神组字段 / 不成对花括号', () => {
    expect(lint(entry({ variants: ['{day.stemm}', 'b'] }))[0]?.message).toContain('{day.stemm}');
    expect(lint(entry({ variants: ['{gods.top|简}', 'b'] }))[0]?.message).toContain('未知过滤器');
    expect(lint(entry({ variants: ['{day.stem|名}', 'b'] }))[0]?.message).toContain(
      '|名 只能用于十神组',
    );
    expect(lint(entry({ variants: ['占 {gods.财_pct%', 'b'] }))[0]?.message).toContain('花括号');
  });
  it('违规：非循环槽位用 {item.*}', () => {
    expect(lint(entry({ variants: ['{item.ganzhi}', 'b'] }))[0]?.rule).toBe('L3');
  });
  it('合规：|名、列表、百分比、循环槽位 item.*', () => {
    expect(
      lint(entry({ variants: ['最强是{gods.top|名}，忌{yongshen.ji}，占 {gods.财_pct}%', 'b'] })),
    ).toEqual([]);
    expect(
      lint(
        entry({
          id: 'CH6-HEAD-X',
          slot: 'CH6-HEAD',
          when: { all: [{ f: 'item.stem_ten_god', eq: '七杀' }] },
          variants: ['{item.year}年是{item.ganzhi}年，{item.stem_god|名}主事', 'b'],
        }),
      ),
    ).toEqual([]);
  });
});

describe('L4 禁用词 / 疾病名 / 金融产品词', () => {
  it('禁用词表从 report-sections.md §7 解析（44 个，含首尾）', () => {
    expect(FORBIDDEN[0]).toBe('血光');
    expect(FORBIDDEN.at(-1)).toBe('贵人多');
    expect(FORBIDDEN).toContain('注定');
    expect(FORBIDDEN.length).toBeGreaterThan(40);
  });
  it('违规：变体与 quote 都查；三类词表', () => {
    expect(lint(entry({ variants: ['这一年注定不平凡', 'b'] }))[0]?.message).toContain(
      '禁用词「注定」',
    );
    expect(lint(entry({ variants: ['a', '容易胃炎'] }))[0]?.message).toContain('疾病名词「胃炎」');
    expect(lint(entry({ variants: ['可以买点基金', 'b'] }))[0]?.message).toContain(
      '金融产品词「基金」',
    );
    const q = entry({
      quote: { text: '有血光之象', source: '《书·篇》', verified: false, edition: '' },
    });
    expect(lint(q)[0]?.message).toContain('quote：命中禁用词「血光」');
  });
  it('合规：白名单豁免；占位符内容不参与；draft 的 verified:false 引文不报错', () => {
    const w = { ...WORDS, whitelist: ['灾害预警'] };
    expect(lint(entry({ variants: ['关注灾害预警信息', 'b'] }), w)).toEqual([]);
    expect(lint(entry({ variants: ['关注灾害预警信息', 'b'] }))[0]?.message).toContain('「灾」');
    const q = entry({
      quote: { text: '甲木参天', source: '《滴天髓·天干论》', verified: false, edition: '' },
    });
    expect(lint(q)).toEqual([]);
  });
});

describe('L5 年份与干支字面', () => {
  it('违规：4 位数字；未锁定的干支', () => {
    expect(lint(entry({ variants: ['2026 年会更好', 'b'] }))[0]?.message).toContain('4 位数字');
    expect(lint(entry({ variants: ['逢甲子之年', 'b'] }))[0]?.message).toContain(
      '干支字面「甲子」',
    );
  });
  it('合规：asserts 锁定该干支；年份用占位符；3 位及以下数字', () => {
    const e = entry({
      id: 'CH6-HEAD-X',
      slot: 'CH6-HEAD',
      when: { all: [{ f: 'item.stem_ten_god', eq: '七杀' }] },
      asserts: [{ f: 'item.ganzhi', eq: '甲子' }],
      variants: ['{item.year}年的甲子年，前 100 天', 'b'],
    });
    expect(lint(e).filter((i) => i.rule === 'L5')).toEqual([]);
  });
});

describe('L6 五行与喜忌词共现', () => {
  it('违规：五行字在喜 / 用 / 有利 / 忌 / 节制 / 不利 8 字内且未锁定', () => {
    for (const v of ['你喜火，夏天精神好', '金对你不利', '需要节制的是水', '木是有利的']) {
      const r = lint(entry({ variants: [v, 'b'] }));
      expect(
        r.map((i) => i.rule),
        v,
      ).toEqual(['L6']);
    }
  });
  it('合规：asserts 锁定（eq / contains / power_pct）；超出 8 字窗口；占位符给出的五行', () => {
    expect(
      lint(
        entry({
          variants: ['你喜火，夏天精神好', 'b'],
          asserts: [{ f: 'yongshen.favorable', contains: '火' }],
        }),
      ),
    ).toEqual([]);
    expect(
      lint(
        entry({ variants: ['土很旺，对你不利', 'b'], asserts: [{ f: 'power_pct.土', gte: 40 }] }),
      ),
    ).toEqual([]);
    expect(lint(entry({ variants: ['火，一二三四五六七八九，喜', 'b'] }))).toEqual([]);
    expect(lint(entry({ variants: ['你喜{yongshen.yong}', 'b'] }))).toEqual([]);
  });
  it('同一变体同一五行只报一次', () => {
    expect(lint(entry({ variants: ['喜火喜火喜火', 'b'] }))).toHaveLength(1);
  });
});

describe('rules/texts 实际素材', () => {
  const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
  const entries = parseTextsFiles(
    readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
      .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
  );

  it('L1–L6 全部通过（禁用词用 §7 词表；疾病 / 金融词表 K01 就绪前为空）', () => {
    expect(
      lintEntries(entries, { forbidden: FORBIDDEN, disease: [], finance: [], whitelist: [] }),
    ).toEqual([]);
  });

  it('draft 条目带 verified:false 的引文不报错（L11 只管 approved，T25）', () => {
    const withQuote = entries.filter((e) => e.quote && !e.quote.verified);
    expect(withQuote.length).toBeGreaterThan(0);
    expect(lintEntries(withQuote, WORDS)).toEqual([]);
  });
});
