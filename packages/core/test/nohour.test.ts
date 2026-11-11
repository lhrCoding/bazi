/**
 * T18 三柱时辰扫描与置信度（strength.md §5 S-NOHOUR）。
 *
 * 验收：C18（高）、C19（低，含晚子甲子时结论）与 cases.json 一致；扫描个数恒为 13。
 */
import { describe, expect, it } from 'vitest';
import type { Gan, GanZhi } from '../src/bazi/ganzhi';
import { computeChart } from '../src/index';
import {
  analyze,
  computeNoHourScan,
  confidenceOf,
  formatRuleHit,
  scanHourPillars,
  CONF_HIGH_DIRECTION_MIN,
  CONF_HIGH_YONG_MIN,
  CONF_MID_DIRECTION_MIN,
  NOHOUR_SCAN_SLOTS,
} from '../src/rules';
import { loadCases } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const { cases } = loadCases();
const hasHour = (id: string): boolean => get(charts, id).pillars.hour !== null;
const charts = new Map(cases.map((c) => [c.id, computeChart(c.input, REF_DATE_MS)]));
const analyses = new Map([...charts].map(([id, ch]) => [id, analyze(ch)]));

function get<T>(m: Map<string, T>, id: string): T {
  const v = m.get(id);
  if (v === undefined) throw new Error(`缺少案例 ${id}`);
  return v;
}
function expectedNoHour(id: string): Record<string, unknown> {
  const c = cases.find((x) => x.id === id);
  return (c?.expected as { no_hour: Record<string, unknown> }).no_hour;
}

describe('strength.md §5 参数 ⇔ 代码常量', () => {
  const md = readRulesFile('strength.md');
  const sec = md.slice(md.indexOf('## 5. 不知道时辰'), md.indexOf('## 6.'));

  it('扫描个数 13', () => {
    expect(sec).toContain('13 个时柱');
    expect(NOHOUR_SCAN_SLOTS).toBe(13);
  });

  it('置信度阈值与 §5 第 3 条表格一致', () => {
    const high =
      /direction_agree \/ scan_slots ≥ ([\d.]+) 且 yong_agree \/ scan_slots ≥ ([\d.]+)/.exec(sec);
    const mid = /\| 中 \| direction_agree \/ scan_slots ≥ ([\d.]+)/.exec(sec);
    expect(high).not.toBeNull();
    expect(mid).not.toBeNull();
    expect(Number(high?.[1])).toBe(CONF_HIGH_DIRECTION_MIN);
    expect(Number(high?.[2])).toBe(CONF_HIGH_YONG_MIN);
    expect(Number(mid?.[1])).toBe(CONF_MID_DIRECTION_MIN);
  });
});

describe('13 个扫描时柱（calendar.md §7、CAL-DH-ZI）', () => {
  // 五鼠遁：甲己→甲子、乙庚→丙子、丙辛→戊子、丁壬→庚子、戊癸→壬子
  const ZI: Record<Gan, Gan> = {
    甲: '甲',
    己: '甲',
    乙: '丙',
    庚: '丙',
    丙: '戊',
    辛: '戊',
    丁: '庚',
    壬: '庚',
    戊: '壬',
    癸: '壬',
  };
  const NEXT: Record<Gan, Gan> = {
    甲: '乙',
    乙: '丙',
    丙: '丁',
    丁: '戊',
    戊: '己',
    己: '庚',
    庚: '辛',
    辛: '壬',
    壬: '癸',
    癸: '甲',
  };
  const days: GanZhi[] = [
    '甲子',
    '乙丑',
    '丙寅',
    '丁卯',
    '戊辰',
    '己巳',
    '庚午',
    '辛未',
    '壬申',
    '癸酉',
  ];

  for (const day of days) {
    it(`${day}日：早子、丑…亥按当日日干，晚子按次日日干，共 13 个`, () => {
      const s = scanHourPillars(day);
      expect(s).toHaveLength(13);
      const g = day[0] as Gan;
      expect(s[0]).toEqual({ slot: 'early-zi', hour: `${ZI[g]}子` });
      expect(s[12]).toEqual({ slot: 'late-zi', hour: `${ZI[NEXT[g]]}子` });
      expect(
        s
          .slice(1, 12)
          .map((x) => x.slot)
          .join(''),
      ).toBe('丑寅卯辰巳午未申酉戌亥');
      expect(
        s
          .slice(1, 12)
          .map((x) => x.hour[1])
          .join(''),
      ).toBe('丑寅卯辰巳午未申酉戌亥');
    });
  }

  it('甲日全部时柱（甲子…乙亥，晚子丙子）', () => {
    expect(scanHourPillars('甲子').map((x) => x.hour)).toEqual([
      '甲子',
      '乙丑',
      '丙寅',
      '丁卯',
      '戊辰',
      '己巳',
      '庚午',
      '辛未',
      '壬申',
      '癸酉',
      '甲戌',
      '乙亥',
      '丙子',
    ]);
  });
});

describe('置信度比例与边界（§5 第 3 条）', () => {
  it('13 个时柱：高 = 方向 ≥ 11 且 用神 ≥ 10；中 = 方向 ≥ 9', () => {
    expect(confidenceOf(13, 13, 13)).toBe('高');
    expect(confidenceOf(11, 10, 13)).toBe('高');
    expect(confidenceOf(11, 9, 13)).toBe('中');
    expect(confidenceOf(10, 13, 13)).toBe('中');
    expect(confidenceOf(9, 0, 13)).toBe('中');
    expect(confidenceOf(8, 13, 13)).toBe('低');
  });

  it('12 个时柱时与 v1 的 10 / 9 / 8 等价（9/12 恰为 0.75 判高）', () => {
    expect(confidenceOf(10, 9, 12)).toBe('高');
    expect(confidenceOf(10, 8, 12)).toBe('中');
    expect(confidenceOf(9, 12, 12)).toBe('中');
    expect(confidenceOf(8, 0, 12)).toBe('中');
    expect(confidenceOf(7, 12, 12)).toBe('低');
  });
});

describe('cases.json 三柱案例', () => {
  it('C18：13 / 13 / 10 → 高；巳、戌时可能从格；晚子戊子时身弱用水', () => {
    const exp = expectedNoHour('C18');
    const a = get(analyses, 'C18');
    const nh = a.no_hour;
    expect(nh).not.toBeNull();
    if (nh === null) return;
    expect([nh.scan_slots, nh.direction_agree, nh.yong_agree]).toEqual([
      exp.scan_slots,
      exp.direction_agree,
      exp.yong_agree,
    ]);
    expect(nh.confidence).toBe(exp.confidence);
    expect(a.confidence).toBe('高');
    expect(nh.alt).toBeNull();
    expect(nh.nohour_cong_possible).toBe(true);
    expect(nh.nohour_cong_hours).toEqual((exp.cong_possible_hours as string[]).map((gz) => gz[1]));
    expect(nh.notes).toContain('若出生于巳时、戌时，可能为从格，喜忌会相反');

    const late = exp.added_late_zi_slot as { hour: string; S: number; level: string; yong: string };
    const slot = nh.slots[12];
    expect(slot?.slot).toBe('late-zi');
    expect(slot?.hour).toBe(late.hour);
    expect(slot?.level).toBe(late.level);
    expect(slot?.yong).toBe(late.yong);
    expect(slot?.S).toBeCloseTo(late.S, 2);
  });

  it('C19：扫描 13 / 9 / 5 本为中；交节后另一组年月柱身旺用水 → 降为低；晚子甲子时身弱用火', () => {
    const exp = expectedNoHour('C19');
    const a = get(analyses, 'C19');
    const nh = a.no_hour;
    expect(nh).not.toBeNull();
    if (nh === null) return;
    expect([nh.scan_slots, nh.direction_agree, nh.yong_agree]).toEqual([
      exp.scan_slots,
      exp.direction_agree,
      exp.yong_agree,
    ]);
    expect(nh.scan_confidence).toBe('中');
    expect(nh.confidence).toBe(exp.confidence);
    expect(a.confidence).toBe('低');
    expect(nh.nohour_cong_possible).toBe(false);
    expect(nh.nohour_cong_hours).toEqual(exp.cong_possible_hours);

    const alt = exp.alt_conclusion as {
      pillars: string[];
      level: string;
      S: number;
      yong: string;
      xi: string[];
      ji: string[];
    };
    expect(nh.alt).not.toBeNull();
    expect(nh.alt?.pillars).toEqual(alt.pillars);
    expect(nh.alt?.level).toBe(alt.level);
    expect(nh.alt?.S).toBeCloseTo(alt.S, 2);
    expect(nh.alt?.yong).toBe(alt.yong);
    expect(nh.alt?.xi).toEqual(alt.xi);
    expect(nh.alt?.ji).toEqual(alt.ji);
    expect(nh.alt?.differs).toBe(true);
    expect(nh.notes.some((n) => n.startsWith('出生当天交节，结论有两种可能'))).toBe(true);
    expect(get(charts, 'C19').uncertain.month_pillar).toEqual(exp.uncertain_year_month);

    const late = exp.added_late_zi_slot as { hour: string; S: number; level: string; yong: string };
    const slot = nh.slots[12];
    expect(slot?.hour).toBe(late.hour);
    expect(slot?.level).toBe(late.level);
    expect(slot?.yong).toBe(late.yong);
    expect(slot?.S).toBeCloseTo(late.S, 2);
  });

  it('C19 去掉交节信息时只按扫描比例 → 中', () => {
    const ch = get(charts, 'C19');
    const nh = analyze({ pillars: ch.pillars }).no_hour;
    expect(nh?.alt).toBeNull();
    expect(nh?.confidence).toBe('中');
  });

  it('三柱主结论不受扫描影响（仍不判从格）', () => {
    for (const id of ['C18', 'C19']) {
      const a = get(analyses, id);
      const withoutScan = analyze({
        pillars: get(charts, id).pillars,
        uncertain: get(charts, id).uncertain,
      });
      expect(a.strength.special).toBeNull();
      expect(withoutScan.strength).toEqual(a.strength);
      expect(withoutScan.yongshen).toEqual(a.yongshen);
    }
  });

  it('rules_hit：S-NOHOUR 排在 Y- 之后，说明为最终置信度', () => {
    expect(
      get(analyses, 'C18')
        .rules_hit.map(formatRuleHit)
        .filter((h) => !h.startsWith('R-'))
        .at(-1),
    ).toBe('S-NOHOUR:高');
    expect(
      get(analyses, 'C19')
        .rules_hit.map(formatRuleHit)
        .filter((h) => !h.startsWith('R-'))
        .at(-1),
    ).toBe('S-NOHOUR:低');
  });
});

describe('知道时辰的命盘', () => {
  it('no_hour 为 null，置信度为高，rules_hit 不含 S-NOHOUR', () => {
    const known = cases.filter((x) => hasHour(x.id));
    expect(known).toHaveLength(18);
    for (const c of known) {
      const a = get(analyses, c.id);
      expect(a.no_hour).toBeNull();
      expect(a.confidence).toBe('高');
      expect(a.rules_hit.some((h) => h.ruleId === 'S-NOHOUR')).toBe(false);
    }
  });

  it('computeNoHourScan 拒绝四柱命盘', () => {
    const c = cases.find((x) => hasHour(x.id));
    if (!c) throw new Error('缺少四柱案例');
    const ch = get(charts, c.id);
    const a = get(analyses, c.id);
    expect(() => computeNoHourScan(ch, a)).toThrow();
  });
});

describe('确定性与扫描个数', () => {
  it('同样输入两次结果完全相同；扫描个数恒为 13', () => {
    const noHour = cases.filter((x) => !hasHour(x.id));
    expect(noHour.map((x) => x.id)).toEqual(['C18', 'C19']);
    for (const c of noHour) {
      const ch = get(charts, c.id);
      const a1 = analyze(ch);
      const a2 = analyze(computeChart(c.input, REF_DATE_MS));
      expect(a2).toEqual(a1);
      expect(a1.no_hour?.scan_slots).toBe(13);
      expect(a1.no_hour?.slots).toHaveLength(13);
    }
  });
});
