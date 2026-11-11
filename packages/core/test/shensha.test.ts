/**
 * T19 吉神（rules/shensha.md v1.1）。
 *
 * 验收：4 张表全量单元测试（10 干 × 12 支、12 支 × 10 干）；解耦回归测试（吉神与旺衰喜忌互不影响）；
 * cases.json shensha_ji 比对（cases.test.ts 中逐案例比对，这里另做 §2 示例与交节日 jishen_display）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DI_ZHI, TIAN_GAN, ganZhiAt, type Gan, type Zhi } from '../src/bazi/ganzhi';
import type { Pillars } from '../src/bazi/types';
import { computeChart } from '../src/index';
import {
  analyze,
  computeJishen,
  computeShensha,
  computeStrength,
  computeYongshen,
  intersectJishen,
  JISHEN_ORDER,
  TAIJI,
  TIANYI,
  WENCHANG,
  YUEDE,
  type Jishen,
  type ShenshaBy,
  type ShenshaPos,
} from '../src/rules';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const md = readRulesFile('shensha.md');

/** 读取 md 中某个小节下第一张两行表格：表头（第一列之后）与值行（第一列之后），按「、」或逐字展开分组。 */
function mdTable(heading: string): { keys: string[][]; values: string[][] } {
  const sec = md.slice(md.indexOf(heading));
  const rows = sec
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .slice(0, 2)
    .map((l) =>
      l
        .split('|')
        .slice(2, -1)
        .map((c) => c.trim()),
    );
  const [head, val] = rows as [string[], string[]];
  return {
    keys: head.map((c) => [...c]),
    values: val.map((c) => c.split('、')),
  };
}

/** md 表格 → 「键 → 值集合」 */
function mdMap(heading: string): Map<string, string[]> {
  const { keys, values } = mdTable(heading);
  const m = new Map<string, string[]>();
  keys.forEach((group, i) => {
    for (const k of group) m.set(k, values[i] as string[]);
  });
  return m;
}

const MD_TIANYI = mdMap('### 1.1 天乙贵人');
const MD_TAIJI = mdMap('### 1.2 太极贵人');
const MD_WENCHANG = mdMap('### 1.3 文昌贵人');
const MD_YUEDE = mdMap('### 1.4 月德贵人');

describe('§1 四张表 ⇔ md（全量覆盖）', () => {
  const cases: [string, Map<string, string[]>, (g: Gan) => readonly Zhi[]][] = [
    ['天乙', MD_TIANYI, (g) => TIANYI[g]],
    ['太极', MD_TAIJI, (g) => TAIJI[g]],
    ['文昌', MD_WENCHANG, (g) => [WENCHANG[g]]],
  ];
  for (const [name, mdm, table] of cases) {
    it(`${name}：10 干 × 12 支逐格一致`, () => {
      expect([...mdm.keys()].sort()).toEqual([...TIAN_GAN].sort());
      for (const g of TIAN_GAN) {
        for (const z of DI_ZHI) {
          expect(table(g).includes(z), `${name} ${g}→${z}`).toBe(
            (mdm.get(g) as string[]).includes(z),
          );
        }
      }
    });
  }

  it('月德：12 支 × 10 干逐格一致', () => {
    expect([...MD_YUEDE.keys()].sort()).toEqual([...DI_ZHI].sort());
    for (const z of DI_ZHI) {
      for (const g of TIAN_GAN) {
        expect(YUEDE[z] === g, `月德 ${z}→${g}`).toBe((MD_YUEDE.get(z) as string[]).includes(g));
      }
    }
  });

  it('§1.1 庚取丑未（不取「庚辛逢马虎」）', () => {
    expect(TIANYI['庚']).toEqual(['丑', '未']);
    expect(TIANYI['辛']).toEqual(['寅', '午']);
  });
});

// ---------- 独立实现的对照（直接用 md 表格，按 §2 伪代码） ----------
function oracle(p: Pillars): Jishen[] {
  const cols = [p.year, p.month, p.day, p.hour];
  const zhiPos: ShenshaPos[] = ['年支', '月支', '日支', '时支'];
  const ganPos: ShenshaPos[] = ['年干', '月干', '日干', '时干'];
  const out: Jishen[] = [];
  for (const name of ['天乙贵人', '月德贵人', '文昌贵人', '太极贵人'] as const) {
    const hits: { pos: ShenshaPos; by: ShenshaBy[] }[] = [];
    cols.forEach((gz, i) => {
      if (gz === null) return;
      if (name === '月德贵人') {
        if ((MD_YUEDE.get(p.month[1] as string) as string[]).includes(gz[0] as string))
          hits.push({ pos: ganPos[i] as ShenshaPos, by: ['月支'] });
        return;
      }
      const mdm = name === '天乙贵人' ? MD_TIANYI : name === '文昌贵人' ? MD_WENCHANG : MD_TAIJI;
      const by: ShenshaBy[] = [];
      if ((mdm.get(p.day[0] as string) as string[]).includes(gz[1] as string)) by.push('日干');
      if ((mdm.get(p.year[0] as string) as string[]).includes(gz[1] as string)) by.push('年干');
      if (by.length > 0) hits.push({ pos: zhiPos[i] as ShenshaPos, by });
    });
    if (hits.length > 0) out.push({ name, hits });
  }
  return out;
}

describe('§2 计算与输出（SS-OUTPUT）', () => {
  it('60 日柱 × 60 年柱（月柱、时柱轮换）与按 md 表格独立实现的结果完全一致；三柱同样一致', () => {
    let n = 0;
    for (let d = 0; d < 60; d++) {
      for (let y = 0; y < 60; y++) {
        const four: Pillars = {
          year: ganZhiAt(y),
          month: ganZhiAt((y * 7 + d) % 60),
          day: ganZhiAt(d),
          hour: ganZhiAt((d * 11 + y * 3) % 60),
        };
        expect(computeJishen(four)).toEqual(oracle(four));
        const three: Pillars = { ...four, hour: null };
        expect(computeJishen(three)).toEqual(oracle(three));
        n += 2;
      }
    }
    expect(n).toBe(7200);
  });

  it('输出示例（C12：乙丑 己卯 戊申 癸丑）与 md 逐字一致', () => {
    const block = /输出示例（案例 C12[^\n]*\n```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const expected = JSON.parse(block?.[1] as string) as Jishen[];
    expect(computeJishen({ year: '乙丑', month: '己卯', day: '戊申', hour: '癸丑' })).toEqual(
      expected,
    );
  });

  it('日干与年干相同（C04 乙亥年乙巳日）：所有日干 / 年干来源的命中 by 都是 [日干, 年干]', () => {
    const j = computeJishen({ year: '乙亥', month: '己卯', day: '乙巳', hour: '丙子' });
    for (const x of j.filter((x) => x.name !== '月德贵人')) {
      for (const h of x.hits) expect(h.by).toEqual(['日干', '年干']);
    }
  });

  it('固定顺序、去重：同一吉神同一位置只出现一次，hits 按 年→月→日→时', () => {
    const j = computeJishen({ year: '甲子', month: '丙寅', day: '甲午', hour: '辛未' });
    expect(j.map((x) => x.name)).toEqual(JISHEN_ORDER.filter((n) => j.some((x) => x.name === n)));
    // 甲日、甲年：天乙丑未 → 时支未；太极子午 → 年支子、日支午；月德寅月丙 → 月干丙；文昌巳 → 无
    expect(j).toEqual([
      { name: '天乙贵人', hits: [{ pos: '时支', by: ['日干', '年干'] }] },
      { name: '月德贵人', hits: [{ pos: '月干', by: ['月支'] }] },
      {
        name: '太极贵人',
        hits: [
          { pos: '年支', by: ['日干', '年干'] },
          { pos: '日支', by: ['日干', '年干'] },
        ],
      },
    ]);
  });

  it('月德查到日干本身也算', () => {
    // 午月 → 丙；丙日
    const j = computeJishen({ year: '庚子', month: '壬午', day: '丙寅', hour: null });
    expect(j.find((x) => x.name === '月德贵人')?.hits).toEqual([{ pos: '日干', by: ['月支'] }]);
  });

  it('没有吉神时输出空列表', () => {
    // 逐个确认：存在完全无吉神的组合，且输出为 []
    let found: Pillars | null = null;
    outer: for (let d = 0; d < 60; d++) {
      for (let y = 0; y < 60; y++) {
        for (let m = 0; m < 60; m += 7) {
          const p: Pillars = {
            year: ganZhiAt(y),
            month: ganZhiAt(m),
            day: ganZhiAt(d),
            hour: null,
          };
          if (oracle(p).length === 0) {
            found = p;
            break outer;
          }
        }
      }
    }
    expect(found).not.toBeNull();
    expect(computeJishen(found as Pillars)).toEqual([]);
  });
});

describe('交节日 + 无时辰：jishen_display 只取两组共有（C19）', () => {
  const c19 = loadCases().cases.find((c) => c.id === 'C19');
  if (!c19) throw new Error('缺少 C19');
  const chart = computeChart(c19.input, REF_DATE_MS);

  it('jishen 为默认一组（癸卯 乙丑）的完整结果；display 只剩两组都有的「太极贵人 · 日支（日干）」', () => {
    const s = computeShensha(chart);
    expect(s.jishen).toEqual(c19.expected.shensha_ji);
    // 另一组 甲辰 丙寅 戊戌：月德 月干；太极 年支、日支（日干）。共有：太极 日支 by 日干
    expect(computeJishen({ year: '甲辰', month: '丙寅', day: '戊戌', hour: null })).toEqual([
      { name: '月德贵人', hits: [{ pos: '月干', by: ['月支'] }] },
      {
        name: '太极贵人',
        hits: [
          { pos: '年支', by: ['日干'] },
          { pos: '日支', by: ['日干'] },
        ],
      },
    ]);
    expect(s.jishen_display).toEqual([{ name: '太极贵人', hits: [{ pos: '日支', by: ['日干'] }] }]);
  });

  it('无交节不确定时 jishen_display 等于 jishen', () => {
    const s = computeShensha({ pillars: chart.pillars });
    expect(s.jishen_display).toEqual(s.jishen);
  });

  it('intersectJishen：by 取交集；位置共有但来源无交集时不保留', () => {
    const a: Jishen[] = [
      {
        name: '天乙贵人',
        hits: [
          { pos: '年支', by: ['日干', '年干'] },
          { pos: '月支', by: ['日干'] },
        ],
      },
    ];
    const b: Jishen[] = [
      {
        name: '天乙贵人',
        hits: [
          { pos: '年支', by: ['年干'] },
          { pos: '月支', by: ['年干'] },
        ],
      },
    ];
    expect(intersectJishen(a, b)).toEqual([
      { name: '天乙贵人', hits: [{ pos: '年支', by: ['年干'] }] },
    ]);
    expect(intersectJishen(a, [])).toEqual([]);
  });
});

describe('解耦回归（SS-SCOPE）', () => {
  const { cases } = loadCases();
  const charts = cases.map((c) => computeChart(c.input, REF_DATE_MS));

  it('旺衰、喜用、三柱扫描的模块不引用 shensha', () => {
    for (const f of ['strength-power.ts', 'strength-level.ts', 'yongshen.ts', 'nohour.ts']) {
      const src = readFileSync(
        fileURLToPath(new URL(`../src/rules/${f}`, import.meta.url)),
        'utf8',
      );
      expect(src, f).not.toMatch(/from '\.\/shensha'/);
    }
  });

  it('shensha 模块不引用旺衰、喜用（反之亦然）', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/rules/shensha.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/from '\.\/(strength-power|strength-level|yongshen|nohour)'/);
  });

  it('把吉神输出替换成任意内容，analyze 的旺衰 / 喜用 / 置信度 / rules_hit 不变', async () => {
    const baseline = charts.map((ch) => analyze(ch));
    vi.resetModules();
    vi.doMock('../src/rules/shensha', () => ({
      computeShensha: () => ({
        jishen: [{ name: '天乙贵人', hits: [{ pos: '年支', by: ['日干'] }] }],
        jishen_display: [],
      }),
    }));
    try {
      const { analyze: mocked } = await import('../src/rules/analyze');
      charts.forEach((ch, i) => {
        const a = mocked(ch);
        const b = baseline[i];
        expect(a.shensha).not.toEqual(b?.shensha);
        expect(a.strength).toEqual(b?.strength);
        expect(a.yongshen).toEqual(b?.yongshen);
        expect(a.confidence).toEqual(b?.confidence);
        expect(a.no_hour).toEqual(b?.no_hour);
        expect(a.notes).toEqual(b?.notes);
        expect(a.rules_hit).toEqual(b?.rules_hit);
      });
    } finally {
      vi.doUnmock('../src/rules/shensha');
      vi.resetModules();
    }
  });

  it('旺衰喜用结果与直接调用（不经 analyze）一致；吉神只由柱决定', () => {
    charts.forEach((ch) => {
      const a = analyze(ch);
      const st = computeStrength(ch.pillars);
      expect(a.strength).toEqual(st);
      expect(a.yongshen).toEqual(computeYongshen(st, ch.pillars.month[1] as Zhi));
      expect(a.shensha).toEqual(computeShensha(ch));
    });
  });

  it('确定性：同样输入两次结果完全相同', () => {
    charts.forEach((ch) => expect(computeShensha(ch)).toEqual(computeShensha(ch)));
  });
});
