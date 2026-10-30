/**
 * T15：五行力量与十神分组（S-POWER / S-ROOT / S-COMBO）、S、得令 / 得地 / 得势、power_display_pct。
 *
 * cases.json 全量 power / gods / S / de_* 对照在 cases.test.ts；这里是规则逐条的构造用例与性质测试。
 */
import { describe, expect, it } from 'vitest';
import { ganZhiAt, type GanZhi } from '../src/bazi/ganzhi';
import type { Pillars } from '../src/bazi/types';
import {
  COMBOS,
  GOD_GROUP_ORDER,
  POSITION_WEIGHTS,
  ROOTLESS_STEM_FACTOR,
  WUXING_ORDER,
  computeStrengthPower,
  elementOfGroup,
  formatRuleHit,
  godGroupOf,
} from '../src/rules';
import { computeChart } from '../src/index';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const P = (year: GanZhi, month: GanZhi, day: GanZhi, hour: GanZhi | null): Pillars => ({
  year,
  month,
  day,
  hour,
});

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
const hitsOf = (r: ReturnType<typeof computeStrengthPower>) => r.rules_hit.map(formatRuleHit);

describe('十神分组（strength.md §1.3）', () => {
  it('五行生克 → 分组（25 种组合）', () => {
    // 日主土：土比劫、火印、金食伤、水财、木官杀
    expect(WUXING_ORDER.map((e) => godGroupOf('土', e))).toEqual([
      '官杀',
      '印',
      '比劫',
      '食伤',
      '财',
    ]);
    for (const dm of WUXING_ORDER) {
      const groups = WUXING_ORDER.map((e) => godGroupOf(dm, e));
      expect(new Set(groups).size).toBe(5);
      for (const g of GOD_GROUP_ORDER) expect(godGroupOf(dm, elementOfGroup(dm, g))).toBe(g);
    }
    expect(elementOfGroup('木', '印')).toBe('水');
    expect(elementOfGroup('木', '财')).toBe('土');
    expect(elementOfGroup('水', '官杀')).toBe('土');
  });
});

describe('S-POWER 示例（strength.md §7，案例 C11 辛酉 戊戌 戊寅 戊午）', () => {
  const r = computeStrengthPower(P('辛酉', '戊戌', '戊寅', '戊午'));

  it('power / gods / S / de_* 与 §7 示例一致', () => {
    const exp = { 木: 0.9, 火: 2.95, 土: 4.25, 金: 2.5, 水: 0.0 };
    for (const e of WUXING_ORDER) expect(r.power[e]).toBeCloseTo(exp[e], 10);
    const gods = { 比劫: 4.25, 印: 2.95, 食伤: 2.5, 财: 0.0, 官杀: 0.9 };
    for (const g of GOD_GROUP_ORDER) expect(r.gods[g]).toBeCloseTo(gods[g], 10);
    expect(Math.round(r.S * 1000) / 1000).toBe(0.679);
    expect(r.day_master).toEqual({ stem: '戊', element: '土' });
    expect([r.de_ling, r.de_di, r.de_shi]).toEqual([true, true, 2]);
    expect(r.pillar_count).toBe(4);
  });

  it('power_display_pct：日主五行加 1.0 后归一（§6），保留 1 位与示例一致', () => {
    const exp = { 木: 7.8, 火: 25.4, 土: 45.3, 金: 21.6, 水: 0.0 };
    for (const e of WUXING_ORDER) expect(Math.round(r.power_display_pct[e] * 10) / 10).toBe(exp[e]);
    expect(sum(r.power_display_pct)).toBeCloseTo(100, 10);
  });

  it('rules_hit：S-POWER + 三合寅午戌火（文字与 §7 示例相同）', () => {
    expect(hitsOf(r)).toEqual(['S-POWER', 'S-COMBO:三合寅午戌火+1.5']);
  });
});

describe('S-POWER 计分步骤', () => {
  it('日干不计分：只改日干，power 不变（gods 随日主变化）', () => {
    const a = computeStrengthPower(P('甲子', '丙寅', '戊辰', '庚申'));
    const b = computeStrengthPower(P('甲子', '丙寅', '壬辰', '庚申'));
    expect(b.power).toEqual(a.power);
    expect(b.day_master.element).toBe('水');
  });

  it('全部天干有根、无合局：total = 四柱总权重 9.1', () => {
    // 年甲(寅藏甲) 月丙(寅藏丙) 时庚(申藏庚)；地支 子 寅 辰 申 → 申子辰三合，换成 午 避开
    const r = computeStrengthPower(P('甲子', '丙寅', '戊午', '庚申'));
    expect(r.stems.every((s) => s.rooted)).toBe(true);
    expect(r.combos).toEqual([]);
    expect(r.total).toBeCloseTo(9.1, 10);
  });

  it('三柱：只用年月日三柱，total = 7.1', () => {
    const r = computeStrengthPower(P('甲子', '丙寅', '戊午', null));
    expect(r.pillar_count).toBe(3);
    expect(r.stems.map((s) => s.pos)).toEqual(['year', 'month']);
    expect(r.total).toBeCloseTo(7.1, 10);
  });

  it('地支按位置权重 × 藏干比例分配：月支丑（3.0）= 己 1.8 + 癸 0.9 + 辛 0.3', () => {
    // 天干都取与地支无关的五行并全部无根，便于拆出地支部分
    const r = computeStrengthPower(P('丙子', '丁丑', '甲子', '丙子'));
    // 地支：年子 0.8 癸，月丑 3.0，日子 1.5 癸，时子 1.0 癸
    // 天干：丙 0.8、丁 1.0、丙 1.0 均无根（藏干无火）
    expect(r.power['土']).toBeCloseTo(1.8, 10);
    expect(r.power['金']).toBeCloseTo(0.3, 10);
    expect(r.power['水']).toBeCloseTo(0.8 + 0.9 + 1.5 + 1.0, 10);
    expect(r.power['火']).toBeCloseTo((0.8 + 1.0 + 1.0) * ROOTLESS_STEM_FACTOR, 10);
    // 亥子丑缺亥，不成三会
    expect(r.combos).toEqual([]);
  });
});

describe('S-ROOT 天干无根 × 0.6', () => {
  it('余气也算出现（寅中戊 0.1 → 戊土有根，不打折）', () => {
    const r = computeStrengthPower(P('甲子', '戊寅', '甲子', '甲子'));
    const month = r.stems.find((s) => s.pos === 'month');
    expect(month).toMatchObject({ stem: '戊', element: '土', rooted: true, score: 1.0 });
    expect(hitsOf(r).some((h) => h.startsWith('S-ROOT'))).toBe(false);
  });

  it('按五行判断而非天干：庚干见酉（辛金）即有根', () => {
    const r = computeStrengthPower(P('庚子', '丁酉', '甲子', '甲子'));
    expect(r.stems.find((s) => s.pos === 'year')).toMatchObject({ rooted: true, score: 0.8 });
  });

  it('藏干中完全没有该五行 → 权重 × 0.6，并记录 S-ROOT（C20 时干甲）', () => {
    const r = computeStrengthPower(P('辛酉', '庚子', '甲戌', '甲戌'));
    const hour = r.stems.find((s) => s.pos === 'hour');
    expect(hour).toMatchObject({ stem: '甲', element: '木', rooted: false });
    expect(hour?.score).toBeCloseTo(POSITION_WEIGHTS.stem.hour * ROOTLESS_STEM_FACTOR, 10);
    expect(r.power['木']).toBeCloseTo(0.6, 10);
    expect(hitsOf(r)).toContain('S-ROOT:时干甲无根×0.6');
  });

  it('三柱时只看三个地支：时支有根在三柱下不算', () => {
    const four = computeStrengthPower(P('甲子', '丙子', '戊子', '丙寅'));
    expect(four.stems.find((s) => s.pos === 'year')?.rooted).toBe(true);
    const three = computeStrengthPower(P('甲子', '丙子', '戊子', null));
    expect(three.stems.find((s) => s.pos === 'year')?.rooted).toBe(false);
    expect(three.stems.find((s) => s.pos === 'year')?.score).toBeCloseTo(0.8 * 0.6, 10);
  });
});

describe('S-COMBO 三会 / 三合（三支全见才加分）', () => {
  it('合局表与 strength.md §2.2 正文一致', () => {
    const md = readRulesFile('strength.md');
    const parsed: { kind: string; branches: string[]; element: string; bonus: number }[] = [];
    for (const kind of ['三会方', '三合局']) {
      const m = new RegExp(`${kind}：(.+?)\\s+\\+([\\d.]+)`).exec(md);
      expect(m, kind).not.toBeNull();
      for (const item of (m?.[1] ?? '').split('、')) {
        const [zs, el] = item.split('→');
        parsed.push({
          kind: kind.slice(0, 2),
          branches: [...(zs ?? '')],
          element: el ?? '',
          bonus: Number(m?.[2]),
        });
      }
    }
    expect(COMBOS.map((c) => ({ ...c, branches: [...c.branches] }))).toEqual(parsed);
  });

  it('三会方：寅卯辰全见 → 木 +2.0', () => {
    const base = computeStrengthPower(P('壬寅', '癸卯', '甲辰', '丙子'));
    expect(base.combos.map((c) => c.kind + c.branches.join(''))).toEqual(['三会寅卯辰']);
    expect(hitsOf(base)).toContain('S-COMBO:三会寅卯辰木+2.0');
    // 只差一个支（辰 → 午）则不加
    const half = computeStrengthPower(P('壬寅', '癸卯', '甲午', '丙子'));
    expect(half.combos).toEqual([]);
    expect(hitsOf(half).some((h) => h.startsWith('S-COMBO'))).toBe(false);
  });

  it('位置不限、重复支不影响：申子辰任意顺序全见 → 水 +1.5', () => {
    const a = computeStrengthPower(P('甲辰', '丙子', '戊申', '庚申'));
    expect(a.combos.map((c) => `${c.kind}${c.element}${c.bonus}`)).toEqual(['三合水1.5']);
    const noCombo = computeStrengthPower(P('甲辰', '丙子', '戊子', '庚子'));
    expect(noCombo.combos).toEqual([]);
  });

  it('加分进入 total：有合局 total = 计分合计 + 加成', () => {
    const r = computeStrengthPower(P('辛酉', '戊戌', '戊寅', '戊午'));
    const stems = r.stems.reduce((s, x) => s + x.score, 0);
    const branches = 0.8 + 3.0 + 1.5 + 1.0;
    expect(r.total).toBeCloseTo(stems + branches + 1.5, 10);
  });

  it('三柱下三个地支也可成局', () => {
    const r = computeStrengthPower(P('丁亥', '癸卯', '乙未', null));
    expect(hitsOf(r)).toContain('S-COMBO:三合亥卯未木+1.5');
  });
});

describe('得令 / 得地 / 得势（strength.md §3）', () => {
  it('得令：月支本气是比劫或印；中气是印不算', () => {
    // 戊日：午月本气丁（印）→ 得令
    expect(computeStrengthPower(P('甲子', '庚午', '戊子', '甲子')).de_ling).toBe(true);
    // 戊日：寅月本气甲（官杀），中气丙（印）→ 不得令
    expect(computeStrengthPower(P('甲子', '丙寅', '戊子', '甲子')).de_ling).toBe(false);
  });

  it('得地：本气 / 中气含比劫算，余气比劫不算；印只认本气', () => {
    // 戊日：地支 子 寅 子 子 —— 寅中戊为余气、丙（印）为中气 → 不得地
    expect(computeStrengthPower(P('甲子', '丙寅', '戊子', '甲子')).de_di).toBe(false);
    // 庚日：地支全为子（癸，食伤）→ 不得地；时支换成巳（中气庚 0.3 为比劫，本气丙为官杀）→ 得地
    expect(computeStrengthPower(P('甲子', '丙子', '庚子', '丙子')).de_di).toBe(false);
    expect(computeStrengthPower(P('甲子', '丙子', '庚子', '辛巳')).de_di).toBe(true);
    // 庚日：地支 子 子 子 丑（丑本气己为印）→ 得地
    expect(computeStrengthPower(P('甲子', '丙子', '庚子', '丁丑')).de_di).toBe(true);
  });

  it('得势：年、月、时三干中比劫 + 印的个数（日干不计），三柱只看年月', () => {
    expect(computeStrengthPower(P('戊子', '丙子', '戊子', '己未')).de_shi).toBe(3);
    expect(computeStrengthPower(P('甲子', '丙子', '戊子', '庚申')).de_shi).toBe(1);
    expect(computeStrengthPower(P('戊子', '丙子', '戊子', null)).de_shi).toBe(2);
  });
});

describe('性质', () => {
  // 遍历一批确定性构造的命盘（干支序号按固定步长取），不依赖随机数
  const samples: Pillars[] = [];
  for (let i = 0; i < 240; i++) {
    samples.push(
      P(
        ganZhiAt(i % 60),
        ganZhiAt((i * 7 + 3) % 60),
        ganZhiAt((i * 13 + 11) % 60),
        i % 5 === 0 ? null : ganZhiAt((i * 31 + 17) % 60),
      ),
    );
  }

  it('gods 合计 = power 合计 = total；S ∈ [0,1]；显示百分比合计 100', () => {
    for (const p of samples) {
      const r = computeStrengthPower(p);
      expect(sum(r.power)).toBeCloseTo(r.total, 10);
      expect(sum(r.gods)).toBeCloseTo(r.total, 10);
      expect(r.S).toBeGreaterThanOrEqual(0);
      expect(r.S).toBeLessThanOrEqual(1);
      expect(r.S).toBeCloseTo((r.gods['比劫'] + r.gods['印']) / r.total, 12);
      expect(sum(r.power_display_pct)).toBeCloseTo(100, 10);
      expect(r.de_shi).toBe(
        r.stems.filter((s) => ['比劫', '印'].includes(godGroupOf(r.day_master.element, s.element)))
          .length,
      );
    }
  });

  it('total = 天干实得分 + 地支总权重 + 合局加成', () => {
    for (const p of samples) {
      const r = computeStrengthPower(p);
      const branchW =
        POSITION_WEIGHTS.branch.year +
        POSITION_WEIGHTS.branch.month +
        POSITION_WEIGHTS.branch.day +
        (p.hour === null ? 0 : POSITION_WEIGHTS.branch.hour);
      const stems = r.stems.reduce((s, x) => s + x.score, 0);
      const combos = r.combos.reduce((s, c) => s + c.bonus, 0);
      expect(r.total).toBeCloseTo(stems + branchW + combos, 10);
    }
  });

  it('确定性：同样输入两次输出完全相同', () => {
    for (const p of samples.slice(0, 30)) {
      expect(computeStrengthPower(p)).toEqual(computeStrengthPower(p));
    }
  });
});

describe('cases.json：S-COMBO 规则命中（rules_hit 中属于 T15 的部分）', () => {
  const REF = Date.parse('2026-10-30T00:00:00+08:00');
  const T15_IDS = new Set(['S-POWER', 'S-ROOT', 'S-COMBO']);
  for (const c of loadCases().cases) {
    const expected = (c.expected.rules_hit_expected as string[]).filter((h) =>
      T15_IDS.has(h.split(/[:：]/)[0] ?? ''),
    );
    it(`${c.id}：S-COMBO 命中与 rules_hit_expected 完全一致（不漏不多）`, () => {
      const r = computeStrengthPower(computeChart(c.input, REF).pillars);
      const actual = hitsOf(r).filter((h) => h.startsWith('S-COMBO'));
      // test_guidance 只要求编号出现；本实现的说明文字与 cases.json 写法相同，这里一并逐字比对
      expect(actual).toEqual(expected.filter((h) => h.startsWith('S-COMBO')));
      expect(hitsOf(r)[0]).toBe('S-POWER');
    });
  }
});
