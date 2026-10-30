/**
 * T16：旺衰等级与特殊格局（S-LEVEL / S-CONG / S-ZHUANWANG）。
 *
 * cases.json 全量 level / special / borderline 对照在 cases.test.ts；这里是规则逐条的构造用例：
 * 判定顺序、从弱 5 条（C03、C07 极弱但不从）、子类型与并列优先级、专旺 / 从强、三柱不判特殊格局、
 * 阈值两侧、borderline、浮点表示误差。
 */
import { describe, expect, it } from 'vitest';
import type { GanZhi } from '../src/bazi/ganzhi';
import type { Pillars } from '../src/bazi/types';
import {
  CONG_MAX_S,
  LEVEL_THRESHOLDS,
  NOTE_NOHOUR_NO_SPECIAL,
  ZHUANWANG_MIN_S,
  checkCong,
  checkZhuanwang,
  computeStrength,
  computeStrengthLevel,
  computeStrengthPower,
  congSpecialOf,
  formatRuleHit,
  isBorderline,
  levelDirection,
  ordinaryLevel,
  zhuanwangSpecialOf,
  type StrengthPower,
} from '../src/rules';
import type { GodGroup, StrengthLevel } from '../src/rules';
import { loadCases } from './helpers/cases';

const P = (year: GanZhi, month: GanZhi, day: GanZhi, hour: GanZhi | null): Pillars => ({
  year,
  month,
  day,
  hour,
});

const hitsOf = (r: { rules_hit: Parameters<typeof formatRuleHit>[0][] }) =>
  r.rules_hit.map(formatRuleHit);

const gods = (o: Partial<Record<GodGroup, number>>): Record<GodGroup, number> => ({
  比劫: 0,
  印: 0,
  食伤: 0,
  财: 0,
  官杀: 0,
  ...o,
});

/** 真实计分结果上只改 S（用于阈值两侧：其余从格条件保持满足）。 */
const withS = (sp: StrengthPower, S: number): StrengthPower => ({ ...sp, S });

const C14 = P('戊申', '辛酉', '丁酉', '己酉');
const C15 = P('癸亥', '乙卯', '乙卯', '癸未');
const C17 = P('戊寅', '己未', '癸未', '戊午');

describe('普通等级 ③–⑥ 与阈值两侧（strength.md §4）', () => {
  it('ordinaryLevel：每个阈值恰好处与略低处', () => {
    expect(ordinaryLevel(0.5)).toBe('身旺');
    expect(ordinaryLevel(0.4999)).toBe('中和偏旺');
    expect(ordinaryLevel(0.45)).toBe('中和偏旺');
    expect(ordinaryLevel(0.4499)).toBe('中和偏弱');
    expect(ordinaryLevel(0.4)).toBe('中和偏弱');
    expect(ordinaryLevel(0.3999)).toBe('身弱');
    expect(ordinaryLevel(0)).toBe('身弱');
    expect(ordinaryLevel(1)).toBe('身旺');
  });

  // 真实命盘（合法干支组合，穷举 60 × 12 × 60 × 12 种找出的阈值附近例子）
  const real: [Pillars, number, StrengthLevel][] = [
    [P('甲子', '丙寅', '乙未', '己卯'), 0.5, '身旺'],
    [P('甲子', '戊辰', '壬申', '庚戌'), 0.4953, '中和偏旺'],
    [P('甲子', '丙寅', '戊子', '己未'), 0.4505, '中和偏旺'],
    [P('甲子', '丙寅', '丁亥', '辛丑'), 0.4459, '中和偏弱'],
    [P('甲子', '丙寅', '戊戌', '甲寅'), 0.4011, '中和偏弱'],
    [P('甲子', '丙寅', '癸酉', '壬戌'), 0.3956, '身弱'],
  ];
  for (const [p, s, level] of real) {
    it(`${p.year} ${p.month} ${p.day} ${p.hour}：S≈${s} → ${level}，borderline`, () => {
      const r = computeStrength(p);
      expect(r.S).toBeCloseTo(s, 4);
      expect(r.level).toBe(level);
      expect(r.special).toBeNull();
      expect(r.borderline).toBe(true);
      expect(hitsOf(r)).toContain(`S-LEVEL:${level}`);
    });
  }

  it('浮点表示误差：S 数学上恰为 4.55 / 9.1 = 0.5，按 ≥ 0.50 判身旺（浮点直接比较会得 0.4999…）', () => {
    const r = computeStrength(P('甲子', '丙寅', '乙未', '己卯'));
    expect(r.gods['比劫'] + r.gods['印']).toBeCloseTo(4.55, 10);
    expect(r.total).toBeCloseTo(9.1, 10);
    expect(r.S).toBeLessThan(0.5); // 二进制浮点
    expect(r.level).toBe('身旺');
  });
});

describe('borderline（strength.md §4.3：S 与阈值 0.50 / 0.45 / 0.40 相差 < 0.01）', () => {
  it('阈值两侧 0.01 以内为 true，恰好相差 0.01 或更远为 false', () => {
    for (const t of Object.values(LEVEL_THRESHOLDS)) {
      expect(isBorderline(t)).toBe(true);
      expect(isBorderline(t + 0.0099)).toBe(true);
      expect(isBorderline(t - 0.0099)).toBe(true);
      expect(isBorderline(t + 0.01)).toBe(false);
      expect(isBorderline(t - 0.01)).toBe(false);
    }
    expect(isBorderline(0.41)).toBe(false); // 0.41 − 0.40 浮点为 0.00999…，按数学值不算
    expect(isBorderline(0.425)).toBe(false);
    expect(isBorderline(0.401)).toBe(true); // C19
    expect(isBorderline(0)).toBe(false);
    expect(isBorderline(0.915)).toBe(false);
  });
});

describe('从弱（S-CONG，只认真从，5 条全满足）', () => {
  it('C14 从财：5 条全满足，财占异党 ≥ 50%', () => {
    const r = computeStrength(C14);
    expect(r.cong).toEqual({
      s_below: true,
      no_root: true,
      no_yin_root: true,
      no_stem_support: true,
      has_hour: true,
      satisfied: true,
    });
    expect([r.level, r.special, r.direction]).toEqual(['从弱', '从财', '偏弱']);
    expect(hitsOf(r)).toEqual(expect.arrayContaining(['S-CONG:从财', 'S-LEVEL:从弱']));
    expect(hitsOf(r).some((h) => h.startsWith('S-ZHUANWANG'))).toBe(false);
  });

  it('C17 从杀', () => {
    const r = computeStrength(C17);
    expect([r.level, r.special]).toEqual(['从弱', '从杀']);
    expect(hitsOf(r)).toContain('S-CONG:从杀');
  });

  it('C03（S = 0.162）极弱但不从：寅中丙火为中气根 → 条件 2 不满足，按身弱', () => {
    const r = computeStrength(P('壬寅', '癸丑', '丙戌', '癸巳'));
    expect(r.S).toBeLessThan(CONG_MAX_S);
    expect(r.cong.s_below).toBe(true);
    expect(r.cong.no_root).toBe(false);
    expect(r.cong.satisfied).toBe(false);
    expect([r.level, r.special]).toEqual(['身弱', null]);
    expect(hitsOf(r).some((h) => h.startsWith('S-CONG'))).toBe(false);
  });

  it('C07（S = 0.148）极弱但不从：辰中癸只是余气不算根，但巳中庚金为中气印 → 条件 3 不满足，按身弱', () => {
    const r = computeStrength(P('癸卯', '乙卯', '癸巳', '丙辰'));
    expect(r.S).toBeLessThan(CONG_MAX_S);
    expect(r.cong.no_root).toBe(true);
    expect(r.cong.no_yin_root).toBe(false);
    expect(r.cong.no_stem_support).toBe(false); // 年干癸为比劫
    expect([r.level, r.special]).toEqual(['身弱', null]);
  });

  it('只有条件 4 不满足（三干透印）也不从', () => {
    // 甲子 丙寅 庚寅 戊寅：庚金日主，月干丙、时干戊……地支无金根、无本气中气土
    const r = computeStrength(P('甲子', '丙寅', '庚寅', '戊寅'));
    expect(r.S).toBeLessThan(CONG_MAX_S);
    expect(r.cong).toMatchObject({
      s_below: true,
      no_root: true,
      no_yin_root: true,
      no_stem_support: false,
      satisfied: false,
    });
    expect(r.level).toBe('身弱');
  });

  it('阈值两侧：其余 4 条满足时 S = 0.1999 从弱，S = 0.20 不从（落到身弱）', () => {
    const sp = computeStrengthPower(C14);
    const below = computeStrengthLevel(withS(sp, 0.1999), C14);
    const at = computeStrengthLevel(withS(sp, CONG_MAX_S), C14);
    expect([below.level, below.special]).toEqual(['从弱', '从财']);
    expect(at.cong).toMatchObject({ s_below: false, satisfied: false });
    expect([at.level, at.special]).toEqual(['身弱', null]);
  });

  it('真实命盘：从儿（戊土日主满盘金）、从势', () => {
    const er = computeStrength(P('甲子', '壬申', '戊申', '庚申'));
    expect([er.level, er.special]).toEqual(['从弱', '从儿']);
    const shi = computeStrength(P('甲子', '丙寅', '庚子', '丙子'));
    expect([shi.level, shi.special]).toEqual(['从弱', '从势']);
    // 从势：异党最大一方不足异党总和的一半
    const alien = shi.gods['食伤'] + shi.gods['财'] + shi.gods['官杀'];
    expect(Math.max(shi.gods['食伤'], shi.gods['财'], shi.gods['官杀'])).toBeLessThan(alien / 2);
  });

  it('子类型：X ≥ 异党 50% 才定从财 / 从杀 / 从儿，恰好 50% 算', () => {
    expect(congSpecialOf(gods({ 财: 5, 官杀: 3, 食伤: 2 }))).toBe('从财');
    expect(congSpecialOf(gods({ 财: 1, 官杀: 6, 食伤: 3 }))).toBe('从杀');
    expect(congSpecialOf(gods({ 财: 1, 官杀: 1, 食伤: 8 }))).toBe('从儿');
    expect(congSpecialOf(gods({ 财: 4, 官杀: 3, 食伤: 3 }))).toBe('从势');
    expect(congSpecialOf(gods({ 财: 0.3, 官杀: 0.2, 食伤: 0.1 }))).toBe('从财'); // 0.3 / 0.6 浮点下也算 50%
  });

  it('并列优先级：财 > 官杀 > 食伤', () => {
    expect(congSpecialOf(gods({ 财: 3, 官杀: 3, 食伤: 0 }))).toBe('从财');
    expect(congSpecialOf(gods({ 财: 0, 官杀: 3, 食伤: 3 }))).toBe('从杀');
    expect(congSpecialOf(gods({ 财: 3, 官杀: 0, 食伤: 3 }))).toBe('从财');
    expect(congSpecialOf(gods({ 财: 0.1 + 0.2, 官杀: 0.3, 食伤: 0 }))).toBe('从财'); // 浮点并列
  });
});

describe('专旺 / 从强（S-ZHUANWANG）', () => {
  it('C15 专旺（曲直）', () => {
    const r = computeStrength(C15);
    expect(r.zhuanwang.satisfied).toBe(true);
    expect([r.level, r.special, r.direction]).toEqual(['从强', '专旺', '偏旺']);
    const hit = r.rules_hit.find((h) => h.ruleId === 'S-ZHUANWANG');
    expect(hit?.text).toBe('专旺');
    expect(hit?.evidence['name']).toBe('曲直');
  });

  it('真实命盘：从强（印多，癸水日主满盘金）', () => {
    const r = computeStrength(P('甲子', '壬申', '癸酉', '辛酉'));
    expect([r.level, r.special]).toEqual(['从强', '从强']);
    expect(r.gods['印']).toBeGreaterThan(r.gods['比劫']);
    expect(hitsOf(r)).toContain('S-ZHUANWANG:从强');
  });

  it('子类型：比劫 ≥ 印 → 专旺（相等算专旺），否则从强', () => {
    expect(zhuanwangSpecialOf(gods({ 比劫: 5, 印: 5 }))).toBe('专旺');
    expect(zhuanwangSpecialOf(gods({ 比劫: 4, 印: 5 }))).toBe('从强');
  });

  it('阈值两侧：其余条件满足时 S = 0.80 成格，S = 0.7999 不成（落到身旺）', () => {
    const sp = computeStrengthPower(C15);
    const at = computeStrengthLevel(withS(sp, ZHUANWANG_MIN_S), C15);
    const below = computeStrengthLevel(withS(sp, 0.7999), C15);
    expect([at.level, at.special]).toEqual(['从强', '专旺']);
    expect(below.zhuanwang).toMatchObject({ s_above: false, satisfied: false });
    expect([below.level, below.special]).toEqual(['身旺', null]);
  });

  it('S ≥ 0.80 但不满足其余条件 → 身旺', () => {
    // 官杀力量 ≥ total × 5%（丙火日主，年支子水 0.8）
    const a = computeStrength(P('甲子', '丙寅', '丙寅', '甲午'));
    expect(a.S).toBeGreaterThanOrEqual(0.8);
    expect(a.zhuanwang).toMatchObject({ guansha_weak: false, satisfied: false });
    expect([a.level, a.special]).toEqual(['身旺', null]);
    // 财 ≥ total × 10%
    const b = computeStrength(P('甲子', '丁卯', '甲辰', '甲子'));
    expect(b.zhuanwang).toMatchObject({ de_ling: true, guansha_weak: true, cai_weak: false });
    expect(b.level).toBe('身旺');
    // 不得令
    const c = computeStrength(P('壬子', '甲辰', '甲子', '甲子'));
    expect(c.S).toBeGreaterThanOrEqual(0.8);
    expect(c.zhuanwang.de_ling).toBe(false);
    expect(c.level).toBe('身旺');
  });

  it('官杀天干透出即不成格（即使官杀力量 < 5%）', () => {
    const sp = computeStrengthPower(C15);
    // C15 三干无官杀；构造：同一计分结果、但把时干换成官杀（辛金）
    const withGuanStem: StrengthPower = {
      ...sp,
      stems: sp.stems.map((s) => (s.pos === 'hour' ? { ...s, stem: '辛', element: '金' } : s)),
    };
    expect(withGuanStem.gods['官杀']).toBeLessThan(withGuanStem.total * 0.05);
    expect(checkZhuanwang(withGuanStem, C15).guansha_weak).toBe(false);
  });
});

describe('三柱不判特殊格局（strength.md §4.1 / §4.2 条件 5、§5 第 1 条）', () => {
  it('C14 去掉时柱：S 极低、其余条件满足也只判身弱（极弱），notes 写明', () => {
    const p = P('戊申', '辛酉', '丁酉', null);
    const r = computeStrength(p);
    expect(r.S).toBeLessThan(CONG_MAX_S);
    expect(r.cong).toMatchObject({ s_below: true, has_hour: false, satisfied: false });
    expect([r.level, r.special, r.extreme]).toEqual(['身弱', null, '极弱']);
    expect(r.notes).toEqual([NOTE_NOHOUR_NO_SPECIAL]);
  });

  it('C15 去掉时柱：只判身旺（极旺）', () => {
    const r = computeStrength(P('癸亥', '乙卯', '乙卯', null));
    expect(r.S).toBeGreaterThanOrEqual(ZHUANWANG_MIN_S);
    expect([r.level, r.special, r.extreme]).toEqual(['身旺', null, '极旺']);
    expect(r.zhuanwang.has_hour).toBe(false);
  });

  it('C18（三柱 S = 0）：身弱（极弱）；三柱普通 S 无极端标注', () => {
    const r = computeStrength(P('庚午', '辛巳', '乙酉', null));
    expect([r.level, r.special, r.extreme]).toEqual(['身弱', null, '极弱']);
    const c19 = computeStrength(P('癸卯', '乙丑', '戊戌', null));
    expect([c19.level, c19.extreme, c19.borderline]).toEqual(['中和偏弱', null, true]);
    expect(c19.notes).toEqual([NOTE_NOHOUR_NO_SPECIAL]);
  });

  it('四柱：extreme 恒为 null，notes 为空', () => {
    const r = computeStrength(P('壬寅', '癸丑', '丙戌', '癸巳'));
    expect(r.extreme).toBeNull();
    expect(r.notes).toEqual([]);
  });
});

describe('输出与规则命中', () => {
  it('rules_hit 顺序：S-POWER → S-ROOT / S-COMBO → S-CONG / S-ZHUANWANG → S-LEVEL（恰好一条 S-LEVEL）', () => {
    expect(hitsOf(computeStrength(C15))).toEqual([
      'S-POWER',
      'S-COMBO:三合亥卯未木+1.5',
      'S-ZHUANWANG:专旺',
      'S-LEVEL:从强',
    ]);
    const c11 = computeStrength(P('辛酉', '戊戌', '戊寅', '戊午'));
    expect(hitsOf(c11)).toEqual(['S-POWER', 'S-COMBO:三合寅午戌火+1.5', 'S-LEVEL:身旺']); // §7 示例
  });

  it('S-LEVEL 依据记录判定步骤与从格逐条检查结果', () => {
    const r = computeStrength(P('壬寅', '癸丑', '丙戌', '癸巳'));
    const hit = r.rules_hit.find((h) => h.ruleId === 'S-LEVEL');
    expect(hit?.evidence).toMatchObject({ step: '⑥', has_hour: true });
    expect(hit?.evidence['cong']).toMatchObject({ no_root: false, satisfied: false });
  });

  it('方向：偏弱组 = 身弱 / 中和偏弱 / 从弱，偏旺组 = 身旺 / 中和偏旺 / 从强', () => {
    const weak: StrengthLevel[] = ['身弱', '中和偏弱', '从弱'];
    const strong: StrengthLevel[] = ['身旺', '中和偏旺', '从强'];
    for (const l of weak) expect(levelDirection(l)).toBe('偏弱');
    for (const l of strong) expect(levelDirection(l)).toBe('偏旺');
  });

  it('从弱与专旺条件互斥（S 区间不重叠），cases.json 全部案例：special 非 null 当且仅当等级为从弱 / 从强', () => {
    const { cases } = loadCases();
    for (const c of cases) {
      const p = c.expected['pillars'] as Pillars;
      const r = computeStrength(p);
      expect(r.cong.satisfied && r.zhuanwang.satisfied).toBe(false);
      expect(r.special !== null, c.id).toBe(r.level === '从弱' || r.level === '从强');
      expect(checkCong(computeStrengthPower(p), p)).toEqual(r.cong);
    }
  });

  it('确定性：同样输入两次结果完全相同', () => {
    for (const p of [C14, C15, C17, P('癸卯', '乙丑', '戊戌', null)]) {
      expect(computeStrength(p)).toEqual(computeStrength(p));
    }
  });
});
