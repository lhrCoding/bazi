/**
 * T17：喜用神全链（yongshen.md v1.1；Y-CONG / Y-ZHUANWANG / Y-FY-* / Y-SWAP / Y-TH-* / Y-TG）。
 *
 * - md 表格 / 参数漂移：§2 特殊格局表、§3 扶抑两张表、§3–§5 的数值阈值与调候月份，从 yongshen.md 原文解析后与代码比对。
 * - §9 自检清单 6 条：1–5 用属性测试（种子固定的伪随机命局 + 全部 6 种特殊格局）逐条断言；6 在本文件逐案断言
 *   （cases.test.ts 另有全字段对照）。
 * - 构造用例：并列优先级、互换边界、调候三种处理（含 v1.1 原用神保留、夏季删土）、通关采用 / 方向冲突 / 已是用神 / 已在喜神。
 * - §6 输出示例（C16）结构比对；analyze 汇总入口。
 */
import { describe, expect, it } from 'vitest';
import type { Gan, Zhi } from '../src/bazi/ganzhi';
import { computeChart } from '../src/index';
import {
  analyze,
  computeYongshen,
  elementOfGroup,
  formatRuleHit,
  fuyi,
  godGroupOf,
  levelDirection,
  ordinaryLevel,
  rankAliens,
  tongguanPair,
  FY_GUANSHA_MIN,
  SPECIAL_PICKS,
  SWAP_XI_MIN,
  TG_MIN_SHARE,
  TH_MAX_SHARE,
  TIAOHOU_NEED,
  WUXING_ORDER,
  type GodGroup,
  type SpecialPattern,
  type StrengthLevel,
  type WuXing,
  type Yongshen,
  type YongshenStrengthInput,
} from '../src/rules';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';
import { extractJsonBlocks } from './helpers/rules-md';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const MD = readRulesFile('yongshen.md');

const DM_STEM: Readonly<Record<WuXing, Gan>> = { 木: '甲', 火: '丙', 土: '戊', 金: '庚', 水: '壬' };

/** 由日主五行与五行力量构造 computeYongshen 的输入（gods / S / level / direction 按 strength.md 推出）。 */
function mk(
  dm: WuXing,
  power: Record<WuXing, number>,
  opt: { level?: StrengthLevel; special?: SpecialPattern | null } = {},
): YongshenStrengthInput {
  const gods = { 比劫: 0, 印: 0, 食伤: 0, 财: 0, 官杀: 0 } as Record<GodGroup, number>;
  for (const e of WUXING_ORDER) gods[godGroupOf(dm, e)] += power[e];
  const total = WUXING_ORDER.reduce((s, e) => s + power[e], 0);
  const S = (gods['比劫'] + gods['印']) / total;
  const level = opt.level ?? ordinaryLevel(S);
  return {
    day_master: { stem: DM_STEM[dm], element: dm },
    power,
    total,
    gods,
    S,
    level,
    special: opt.special ?? null,
    direction: levelDirection(level),
  };
}

const pw = (木: number, 火: number, 土: number, 金: number, 水: number): Record<WuXing, number> => ({
  木,
  火,
  土,
  金,
  水,
});

const yIds = (y: Yongshen) => y.rules_hit.map((h) => h.ruleId);
const sets = (y: Yongshen) => ({ yong: y.yong, xi: y.xi, ji: y.ji, xian: y.xian });

// ---------- md 表格与参数漂移 ----------

function tableRows(section: string): string[][] {
  const start = MD.indexOf(section);
  expect(start, `yongshen.md 中找不到「${section}」`).toBeGreaterThanOrEqual(0);
  const rest = MD.slice(start);
  const end = rest.slice(1).search(/\n#{2,3} /);
  return (end < 0 ? rest : rest.slice(0, end + 1))
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.startsWith('|---'))
    .slice(1)
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    );
}
const groups = (cell: string): string[] => cell.split('、');

describe('yongshen.md 表格与参数 ⇔ 代码常量', () => {
  it('§2 特殊格局表 ⇔ SPECIAL_PICKS（6 行，用 / 喜 / 忌及顺序）', () => {
    const rows = tableRows('## 2. 特殊格局');
    expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(SPECIAL_PICKS).sort());
    for (const [special, yong, xi, ji] of rows as string[][]) {
      const p = SPECIAL_PICKS[special as SpecialPattern];
      expect([p.yong, p.xi, p.ji], special).toEqual([yong, groups(xi as string), groups(ji as string)]);
    }
  });

  it('§3.1 偏弱表 ⇔ fuyi（D 为异党最强时的用 / 喜 / 忌首位 / 规则）', () => {
    const rows = tableRows('### 3.1 偏弱');
    expect(rows).toHaveLength(3);
    for (const [d, yong, xi, ji, rule] of rows as string[][]) {
      const g = { 比劫: 1, 印: 1, 食伤: 1, 财: 1, 官杀: 1 } as Record<GodGroup, number>;
      g[d as GodGroup] = 5;
      const r = fuyi(g, '偏弱');
      expect([r.rule, r.yong, r.xi, r.ji[0]], d).toEqual([rule, yong, [xi], d]);
      expect(groups(ji as string)[1]).toBe('异党第二强');
    }
  });

  it('§3.2 偏旺表 ⇔ fuyi', () => {
    const rows = tableRows('### 3.2 偏旺');
    expect(rows).toHaveLength(3);
    const cases: Record<string, Record<GodGroup, number>> = {
      'Y-FY-S-YIN': { 比劫: 2, 印: 3, 食伤: 1, 财: 1, 官杀: 2 },
      'Y-FY-S-BI-GUAN': { 比劫: 3, 印: 2, 食伤: 1, 财: 1, 官杀: 1.5 },
      'Y-FY-S-BI-SHI': { 比劫: 3, 印: 2, 食伤: 1, 财: 1, 官杀: 0.5 },
    };
    for (const [, yong, xi, ji, rule] of rows as string[][]) {
      const r = fuyi(cases[rule as string] as Record<GodGroup, number>, '偏旺');
      expect([r.rule, r.yong, r.xi, r.ji], rule).toEqual([rule, yong, [xi], groups(ji as string)]);
    }
  });

  it('§3.2 官杀阈值、§3.3 互换阈值、§4 调候比例、§5 通关比例与 md 原文一致', () => {
    expect(MD).toContain(`官杀力量 ≥ ${FY_GUANSHA_MIN.toFixed(1)}`);
    expect(MD).toContain(`第一喜神力量 ≥ ${SWAP_XI_MIN.toFixed(1)}`);
    expect(MD).toContain(`power / total < ${TH_MAX_SHARE.toFixed(2)}`);
    expect(MD).toContain(`total × ${TG_MIN_SHARE * 100}%`);
  });

  it('§4 调候月份 ⇔ TIAOHOU_NEED（亥子丑需火、巳午未需水，春秋不调候）', () => {
    const m = [...MD.matchAll(/月支 ∈ \{(.+?)\} → 需要 (.)/g)].map((x) => [
      (x[1] as string).split(/,\s*/),
      x[2],
    ]);
    const fromMd: Record<string, string> = {};
    for (const [zs, e] of m) for (const z of zs as string[]) fromMd[z] = e as string;
    expect(fromMd).toEqual(TIAOHOU_NEED);
  });
});

// ---------- 构造用例 ----------

describe('扶抑（§3）并列与边界', () => {
  it('偏弱：异党并列按 官杀 > 食伤 > 财，第二强同样按此排', () => {
    expect(rankAliens({ 比劫: 0, 印: 0, 食伤: 2, 财: 2, 官杀: 2 })).toEqual(['官杀', '食伤', '财']);
    expect(fuyi({ 比劫: 1, 印: 1, 食伤: 2, 财: 2, 官杀: 1 }, '偏弱')).toMatchObject({
      rule: 'Y-FY-W-SHI',
      ji: ['食伤', '财'],
    });
    expect(fuyi({ 比劫: 1, 印: 1, 食伤: 1, 财: 3, 官杀: 1 }, '偏弱')).toMatchObject({
      rule: 'Y-FY-W-CAI',
      yong: '比劫',
      xi: ['印'],
      ji: ['财', '官杀'],
    });
  });

  it('偏旺：比劫 = 印 取比劫；官杀恰为 1.0 用官杀，略低用食伤', () => {
    const base = { 比劫: 2, 印: 2, 食伤: 0.5, 财: 0.5 };
    expect(fuyi({ ...base, 官杀: 1.0 }, '偏旺').rule).toBe('Y-FY-S-BI-GUAN');
    expect(fuyi({ ...base, 官杀: 0.99 }, '偏旺').rule).toBe('Y-FY-S-BI-SHI');
    expect(fuyi({ ...base, 印: 2.01, 官杀: 1 }, '偏旺').rule).toBe('Y-FY-S-YIN');
  });
});

describe('用神缺位互换（§3.3 Y-SWAP）', () => {
  // 戊土身弱、官杀（木）最重 → 扶抑用印（火）；火力量 0
  const base = (earth: number) => mk('土', pw(4, 0, earth, 1, 2));

  it('第一喜神 ≥ 1.0 → 互换，喜忌集合不变', () => {
    const y = computeYongshen(base(1.0), '卯');
    expect(sets(y)).toEqual({ yong: '土', xi: ['火'], ji: ['木', '水'], xian: ['金'] });
    expect([y.swap, y.swap_from, y.swap_to]).toEqual([true, '火', '土']);
    expect(yIds(y)).toEqual(['Y-FY-W-SHA', 'Y-SWAP']);
    expect(y.fy).toEqual({ yong: '火', xi: ['土'], ji: ['木', '水'] });
  });

  it('第一喜神 < 1.0 → 不互换（C18 同理：用神水为 0，喜神木也为 0）', () => {
    const y = computeYongshen(base(0.99), '卯');
    expect(y.yong).toBe('火');
    expect(y.swap).toBe(false);
    expect(yIds(y)).not.toContain('Y-SWAP');
  });

  it('用神力量非 0（哪怕很小）→ 不互换', () => {
    const y = computeYongshen(mk('土', pw(4, 0.01, 2, 1, 2)), '卯');
    expect([y.yong, y.swap]).toEqual(['火', false]);
  });
});

describe('调候修正（§4 Y-TH-*）', () => {
  it('AGREE：调候五行已是用神（C01 同型），集合不变', () => {
    const y = computeYongshen(mk('土', pw(1.8, 0.15, 2.8, 2.35, 2.0)), '丑');
    expect(sets(y)).toEqual({ yong: '火', xi: ['土'], ji: ['金', '水'], xian: ['木'] });
    expect([y.th, y.th_element]).toEqual(['AGREE', '火']);
  });

  it('占比恰为 10% 不触发；春秋月不触发', () => {
    const at10 = computeYongshen(mk('木', pw(1.0, 0.8, 4.0, 0.7, 1.5)), '子'); // 火 0.8 / 8.0 = 10%
    expect(at10.th).toBeNull();
    expect(at10.th_element).toBeNull();
    const spring = computeYongshen(mk('木', pw(1.0, 0.1, 4.0, 0.7, 1.5)), '卯');
    expect(spring.th).toBeNull();
  });

  it('ADD-XI（身弱）：用神不变，调候五行追加到喜神末尾并从忌神删除', () => {
    // 甲木身弱、财（土）最重、第二强食伤（火）→ 用木喜水、忌土火；子月火 0.7 / 7.8 < 10%
    const y = computeYongshen(mk('木', pw(1.0, 0.7, 4.0, 0.6, 1.5)), '子');
    expect(sets(y)).toEqual({ yong: '木', xi: ['水', '火'], ji: ['土'], xian: ['金'] });
    expect(yIds(y)).toEqual(['Y-FY-W-CAI', 'Y-TH-ADD-XI']);
  });

  it('ADD-XI（身弱）：调候五行原为闲神时只追加', () => {
    // 庚金身弱、食伤（水）最重 → 用土喜金、忌水木；火（官杀）为闲神，子月 5.5% → 追加
    const y = computeYongshen(mk('金', pw(1.5, 0.5, 1.5, 1.0, 4.6)), '子');
    expect(sets(y)).toEqual({ yong: '土', xi: ['金', '火'], ji: ['水', '木'], xian: [] });
  });

  it('NEUTRAL-OVERRIDE 冬（C16 同型）：原用神保留为第一喜神，原喜神中的水删去', () => {
    const y = computeYongshen(mk('木', pw(2.15, 0.45, 3.7, 1.1, 1.7)), '丑');
    expect(sets(y)).toEqual({ yong: '火', xi: ['木'], ji: ['土', '金'], xian: ['水'] });
    expect([y.th, y.th_removed]).toEqual(['NEUTRAL-OVERRIDE', '水']);
  });

  it('NEUTRAL-OVERRIDE 冬（v1.1，C20 同型）：原用神恰是水时仍为第一喜神，不变闲神', () => {
    const y = computeYongshen(mk('木', pw(0.6, 0.25, 1.5, 3.35, 3.0)), '子');
    expect(sets(y)).toEqual({ yong: '火', xi: ['水', '木'], ji: ['金', '土'], xian: [] });
    expect(y.th_removed).toBeNull();
    expect(y.basis[1]).toContain('扶抑选出的用神保留为第一喜神');
  });

  it('NEUTRAL-OVERRIDE 夏：原喜神中的土删去', () => {
    // 庚金中和偏弱、财（木）最重 → 用金喜土、忌木火；午月水 0.7 / 9.5 < 10% → 用水、喜金，土删去
    const st = mk('金', pw(3.0, 1.8, 2.0, 2.0, 0.7));
    expect(st.level).toBe('中和偏弱');
    const y = computeYongshen(st, '午');
    expect(sets(y)).toEqual({ yong: '水', xi: ['金'], ji: ['木', '火'], xian: ['土'] });
    expect([y.th, y.th_removed]).toEqual(['NEUTRAL-OVERRIDE', '土']);
  });

  it('NEUTRAL-OVERRIDE 夏（v1.1）：原用神恰是土时仍为第一喜神；忌神中删去调候五行', () => {
    // 丙火中和偏旺、比劫为主、官杀（水）< 1.0 → 用土喜金、忌火木；未月水 0.5 / 10 < 10%
    const st = mk('火', pw(2.0, 2.6, 2.4, 2.5, 0.5));
    expect(st.level).toBe('中和偏旺');
    const y = computeYongshen(st, '未');
    expect(sets(y)).toEqual({ yong: '水', xi: ['土', '金'], ji: ['火', '木'], xian: [] });
  });
});

describe('通关修正（§5 Y-TG）', () => {
  it('偏旺：Z 为官杀、不在忌神 → 追加到喜神末尾', () => {
    // 甲木身旺、印（水）为主 → 用土喜火、忌水木；土、水各 3.0（31.6%），土克水 → 金通关
    const y = computeYongshen(mk('木', pw(2.5, 0.5, 3.0, 0.5, 3.0)), '卯');
    expect(sets(y)).toEqual({ yong: '土', xi: ['火', '金'], ji: ['水', '木'], xian: [] });
    expect([y.tg, y.tg_element]).toEqual([true, '金']);
    expect(yIds(y)).toEqual(['Y-FY-S-YIN', 'Y-TG']);
    expect(y.tongguan).toMatchObject({ a: '土', b: '水', attacker: '土', target: '水', adopted: true });
  });

  it('方向冲突 → 不采用，只写 notes（C03 同型）', () => {
    const y = computeYongshen(mk('火', pw(0.48, 0.99, 2.88, 1.05, 3.7)), '丑');
    expect(y.tg).toBe(false);
    expect(y.notes).toEqual(['土克水，两强相战，金可通关，但与扶抑方向冲突，未采用']);
    expect(yIds(y)).not.toContain('Y-TG');
  });

  it('Z 已在喜神 → 不重复追加，notes 记录', () => {
    // 丙火身弱、食伤（土）最重 → 用木喜火；木、土两强，木克土 → 火通关，已在喜神
    const y = computeYongshen(mk('火', pw(3.0, 0.5, 3.2, 1.0, 1.5)), '卯');
    expect(sets(y)).toEqual({ yong: '木', xi: ['火'], ji: ['土', '水'], xian: ['金'] });
    expect(y.tongguan).toMatchObject({ element: '火', already_xi: true, adopted: false });
    expect(y.notes).toEqual(['木克土，两强相战，火可通关，火已在喜神中']);
  });

  it('两强之一不足 25% 或两强不相克 → 不检查', () => {
    expect(tongguanPair(pw(4, 0, 2.4, 1, 2.6), 10)).toBeNull(); // 木 40%、水 26%：水生木
    expect(tongguanPair(pw(5, 0, 2.4, 0.1, 2.5), 10)).toBeNull(); // 木克土但土 24%
    expect(tongguanPair(pw(5, 0, 2.5, 0, 2.5), 10)).toMatchObject({ a: '木', b: '土', element: '火' });
  });

  it('特殊格局跳过互换、调候、通关', () => {
    // 丁火从财，冬月、火 0：若不跳过会触发调候
    const st = mk('火', pw(0, 0, 1.88, 6.98, 0.24), { level: '从弱', special: '从财' });
    const y = computeYongshen(st, '子');
    expect(sets(y)).toEqual({ yong: '金', xi: ['土'], ji: ['火', '木'], xian: ['水'] });
    expect(yIds(y)).toEqual(['Y-CONG']);
    expect([y.swap, y.th, y.tg, y.tongguan]).toEqual([false, null, false, null]);
  });
});

// ---------- §9 自检清单 ----------

/** 种子固定的伪随机数（mulberry32），保证属性测试可复现。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZHIS: readonly Zhi[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const SPECIALS: readonly SpecialPattern[] = ['从财', '从杀', '从儿', '从势', '专旺', '从强'];

interface Sample {
  st: YongshenStrengthInput;
  zhi: Zhi;
  y: Yongshen;
}

const samples: Sample[] = (() => {
  const rand = rng(20261030);
  const out: Sample[] = [];
  // 力量取 0–5（步长 0.05），约 1/6 概率取 0（覆盖互换）；
  for (let i = 0; i < 6000; i++) {
    const dm = WUXING_ORDER[i % 5] as WuXing;
    const v = () => (rand() < 0.17 ? 0 : Math.round(rand() * 100) * 0.05);
    const p = pw(v(), v(), v(), v(), v());
    if (WUXING_ORDER.every((e) => p[e] === 0)) continue;
    const zhi = ZHIS[Math.floor(rand() * 12)] as Zhi;
    const special = rand() < 0.1 ? (SPECIALS[Math.floor(rand() * 6)] as SpecialPattern) : null;
    const st = mk(dm, p, special === null ? {} : { level: special.startsWith('从') && special !== '从强' ? '从弱' : '从强', special });
    out.push({ st, zhi, y: computeYongshen(st, zhi) });
  }
  return out;
})();

const group = (s: Sample, e: WuXing): GodGroup => godGroupOf(s.st.day_master.element, e);

describe('yongshen.md §9 自检清单（属性测试，6000 个种子固定的命局）', () => {
  it('样本覆盖全部规则分支', () => {
    const hit = new Set(samples.flatMap((s) => yIds(s.y)));
    for (const id of [
      'Y-CONG',
      'Y-ZHUANWANG',
      'Y-FY-W-SHA',
      'Y-FY-W-SHI',
      'Y-FY-W-CAI',
      'Y-FY-S-YIN',
      'Y-FY-S-BI-GUAN',
      'Y-FY-S-BI-SHI',
      'Y-SWAP',
      'Y-TH-AGREE',
      'Y-TH-NEUTRAL-OVERRIDE',
      'Y-TH-ADD-XI',
      'Y-TG',
    ]) {
      expect(hit.has(id as never), id).toBe(true);
    }
  });

  it('1. 用、喜、忌、闲互不重复，并集 = 五行；喜神、忌神各 1–3 个', () => {
    for (const s of samples) {
      const all = [s.y.yong, ...s.y.xi, ...s.y.ji, ...s.y.xian];
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);
      expect(s.y.xi.length).toBeGreaterThanOrEqual(1);
      expect(s.y.xi.length).toBeLessThanOrEqual(3);
      expect(s.y.ji.length).toBeGreaterThanOrEqual(1);
      expect(s.y.ji.length).toBeLessThanOrEqual(3);
    }
  });

  it('2. 偏弱命局：用神 ∈ {印, 比劫}，或调候覆盖后为调候五行', () => {
    const weak = samples.filter((s) => s.st.special === null && s.st.direction === '偏弱');
    expect(weak.length).toBeGreaterThan(100);
    for (const s of weak) {
      const ok =
        ['印', '比劫'].includes(group(s, s.y.yong)) ||
        (s.y.th === 'NEUTRAL-OVERRIDE' && s.y.yong === s.y.th_element);
      expect(ok, JSON.stringify(s.st.power)).toBe(true);
    }
  });

  it('3. 偏旺命局：用神 ∈ {食伤, 财, 官杀}，或调候覆盖后为调候五行', () => {
    const strong = samples.filter((s) => s.st.special === null && s.st.direction === '偏旺');
    expect(strong.length).toBeGreaterThan(100);
    for (const s of strong) {
      const ok =
        ['食伤', '财', '官杀'].includes(group(s, s.y.yong)) ||
        (s.y.th === 'NEUTRAL-OVERRIDE' && s.y.yong === s.y.th_element);
      expect(ok, JSON.stringify(s.st.power)).toBe(true);
    }
  });

  it('4. 特殊格局：从弱各类忌神含印；专旺 / 从强忌神含财、官杀', () => {
    for (const special of SPECIALS) {
      for (const dm of WUXING_ORDER) {
        const st = mk(dm, pw(1, 1, 1, 1, 1), {
          level: special === '专旺' || special === '从强' ? '从强' : '从弱',
          special,
        });
        const y = computeYongshen(st, '子');
        const jiGroups = y.ji.map((e) => godGroupOf(dm, e));
        if (special === '专旺' || special === '从强') {
          expect(jiGroups, special).toEqual(expect.arrayContaining(['财', '官杀']));
          expect(yIds(y)).toEqual(['Y-ZHUANWANG']);
        } else {
          expect(jiGroups, special).toContain('印');
          expect(yIds(y)).toEqual(['Y-CONG']);
        }
        expect(y.yong).toBe(elementOfGroup(dm, SPECIAL_PICKS[special].yong));
      }
    }
  });

  it('5. 每个结论都有 rules_hit 和 basis：恰好一条格局 / 扶抑编号，且每条 Y- 命中对应一句依据', () => {
    for (const s of samples) {
      const ids = yIds(s.y);
      expect(ids[0]).toBe(s.y.fy_rule);
      expect(ids.filter((id) => id.startsWith('Y-FY-') || id === 'Y-CONG' || id === 'Y-ZHUANWANG')).toHaveLength(1);
      expect(s.y.basis).toHaveLength(ids.length);
      for (const b of s.y.basis) expect(b.length).toBeGreaterThan(10);
      // 标志字段与命中编号一致
      expect(s.y.swap).toBe(ids.includes('Y-SWAP'));
      expect(s.y.tg).toBe(ids.includes('Y-TG'));
      expect(s.y.th === null ? null : `Y-TH-${s.y.th}`).toBe(ids.find((id) => id.startsWith('Y-TH-')) ?? null);
    }
  });

  it('确定性：同样输入两次结果完全相同', () => {
    for (const s of samples.slice(0, 500)) expect(computeYongshen(s.st, s.zhi)).toEqual(s.y);
  });
});

// ---------- cases.json（§9 第 6 条）与 §6 输出示例 ----------

const { cases } = loadCases();
const analyses = new Map(cases.map((c) => [c.id, analyze(computeChart(c.input, REF_DATE_MS))]));

describe('cases.json 喜用神（§9 第 6 条）', () => {
  for (const c of cases) {
    it(`${c.id} ${c.title}`, () => {
      const a = analyses.get(c.id);
      expect(a).toBeDefined();
      expect(sets((a as NonNullable<typeof a>).yongshen)).toEqual(c.expected.yongshen);
    });
  }

  it('C12 用神缺位互换、C16 调候覆盖、C01 调候一致、C20 v1.1 原用神保留', () => {
    const y = (id: string) => (analyses.get(id) as NonNullable<ReturnType<typeof analyses.get>>).yongshen;
    expect([y('C12').swap_from, y('C12').swap_to]).toEqual(['火', '土']);
    expect([y('C16').th, y('C16').th_removed]).toEqual(['NEUTRAL-OVERRIDE', '水']);
    expect(y('C01').th).toBe('AGREE');
    expect([y('C20').th, y('C20').fy.yong, y('C20').xi[0]]).toEqual(['NEUTRAL-OVERRIDE', '水', '水']);
  });

  it('§6 输出示例（C16）：结构、喜忌、rules_hit 一致；调候依据句与示例逐字相同', () => {
    const block = extractJsonBlocks('yongshen.md').find((b) => b.heading === '6. 闲神与输出');
    const ex = block?.value as Record<string, unknown> & { basis: string[]; rules_hit: string[] };
    const y = (analyses.get('C16') as NonNullable<ReturnType<typeof analyses.get>>).yongshen;
    for (const k of Object.keys(ex)) expect(k in y, `缺少字段 ${k}`).toBe(true);
    expect(sets(y)).toEqual({ yong: ex.yong, xi: ex.xi, ji: ex.ji, xian: ex.xian });
    expect(y.rules_hit.map(formatRuleHit)).toEqual(ex.rules_hit);
    expect(y.basis).toHaveLength(ex.basis.length);
    expect(y.basis[1]).toBe(ex.basis[1]);
    expect(y.basis[0]).toMatch(/^乙木生于丑月，同党占 42%，属中和偏弱/);
  });

  it('analyze：rules_hit 为 S- 在前、Y- 在后；notes 合并 strength 与 yongshen', () => {
    const a = analyses.get('C18') as NonNullable<ReturnType<typeof analyses.get>>;
    const ids = a.rules_hit.map((h) => h.ruleId);
    const firstY = ids.findIndex((id) => id.startsWith('Y-'));
    expect(ids.slice(0, firstY).every((id) => id.startsWith('S-'))).toBe(true);
    expect(ids.slice(firstY).every((id) => id.startsWith('Y-'))).toBe(true);
    expect(a.notes).toEqual([...a.strength.notes, ...a.yongshen.notes]);
  });
});
