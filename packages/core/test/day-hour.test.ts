/**
 * T07：CAL-DH 日柱、时柱与早晚子时（rules/calendar.md §3）。
 * - 日柱参考点 2000-01-01 戊午；五鼠遁全表；时辰左闭右开。
 * - 锁定：C05（23:30 → 乙巳日戊子时）、C04（00:30 → 乙巳日丙子时），alt 为 23:00 换日派日柱。
 * - 真太阳时：C08 跨午夜日柱、时柱都变；校正后跨 23:00 只改时柱、不改日柱。
 * - 未校正时与 tyme4ts（Sect2）交叉校验：随机时刻 + 晚子时专项 + 每日整点。
 */
import { describe, expect, it } from 'vitest';
import { tymePillarsAt } from '../src/bazi/calendar-adapter';
import { clockToUtc } from '../src/bazi/clock';
import { computeDayHour, dayPillarIndex, dayPillarOf, shichenIndex } from '../src/bazi/day-hour';
import { ganZhiAt } from '../src/bazi/ganzhi';
import { fromBeijingParts, toBeijingParts, type DateTimeParts } from '../src/bazi/time';
import { computeTrueSolarTime } from '../src/bazi/true-solar-time';
import { loadCases } from './helpers/cases';

const at = (s: string): DateTimeParts => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad datetime ${s}`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: 0,
  };
};

/** 北京钟表时间 + 经度 → 当地时间 → 日柱时柱（完整链路：CAL-TZ → CAL-TST → CAL-DH） */
function chain(datetime: string, longitude: number | null) {
  const [d, t] = datetime.split(' ') as [string, string];
  const { utcMs } = clockToUtc(d, t, 'Asia/Shanghai');
  const tst = computeTrueSolarTime(utcMs, longitude);
  return { tst, dh: computeDayHour(tst.local) };
}

describe('日柱：60 甲子连续计数', () => {
  it('参考点 2000-01-01 = 戊午', () => {
    expect(dayPillarOf(2000, 1, 1)).toBe('戊午');
  });

  it('相邻日序号 +1，跨月、跨年、闰日连续', () => {
    const pairs: [number, number, number, number, number, number][] = [
      [1999, 12, 31, 2000, 1, 1],
      [2000, 2, 28, 2000, 2, 29],
      [2000, 2, 29, 2000, 3, 1],
      [1900, 2, 28, 1900, 3, 1], // 1900 不是闰年
      [2100, 12, 30, 2100, 12, 31],
    ];
    for (const [y1, m1, d1, y2, m2, d2] of pairs) {
      expect((dayPillarIndex(y2, m2, d2) - dayPillarIndex(y1, m1, d1) + 60) % 60).toBe(1);
    }
  });

  it('60 天一循环；1900-01-01 甲戌（与 tyme4ts 一致）', () => {
    expect(dayPillarOf(2000, 3, 1)).toBe(dayPillarOf(2000, 4, 30));
    expect(dayPillarOf(1900, 1, 1)).toBe(tymePillarsAt(at('1900-01-01 12:00')).day);
    expect(dayPillarOf(1900, 1, 1)).toBe('甲戌');
  });
});

describe('时柱：时辰划分与五鼠遁', () => {
  it('时辰左闭右开：23 点、0 点为子，1、2 点为丑 …… 21、22 点为亥', () => {
    const expected = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 0];
    for (let h = 0; h < 24; h++) expect(shichenIndex(h)).toBe(expected[h]);
  });

  it('五鼠遁：甲己日甲子、乙庚日丙子、丙辛日戊子、丁壬日庚子、戊癸日壬子（早子时）', () => {
    const ziStem: Record<string, string> = {
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
    // 2000-01-01 戊午起连续 10 天覆盖全部日干
    for (let i = 0; i < 10; i++) {
      const p = toBeijingParts(fromBeijingParts({ ...at('2000-01-01 00:30'), day: 1 + i }));
      const r = computeDayHour(p);
      const dayStem = r.day[0] as string;
      expect(r.hour).toBe(`${ziStem[dayStem]}子`);
    }
  });

  it('同一日内 00:00–22:59 的 12 个时辰干支连续（甲子序号逐个 +1）', () => {
    const base = computeDayHour(at('1995-03-15 00:00'));
    const baseIdx = Array.from({ length: 60 }, (_, i) => ganZhiAt(i)).indexOf(base.hour);
    for (let h = 0; h < 23; h++) {
      const r = computeDayHour({ ...at('1995-03-15 00:00'), hour: h });
      expect(r.hour).toBe(ganZhiAt(baseIdx + shichenIndex(h)));
      expect(r.day).toBe('乙巳');
    }
  });

  it('非法当地时间抛错', () => {
    expect(() => computeDayHour({ ...at('2000-01-01 00:00'), hour: 24 })).toThrow();
    expect(() => computeDayHour({ ...at('2000-01-01 00:00'), month: 13 })).toThrow();
  });
});

describe('CAL-DH-ZI 早晚子时派（锁定）', () => {
  it('C05：1995-03-15 23:30 → 乙巳日戊子时；23:00 换日派日柱丙午', () => {
    const r = computeDayHour(at('1995-03-15 23:30'));
    expect(r.day).toBe('乙巳');
    expect(r.hour).toBe('戊子');
    expect(r.zi_huanri_day_pillar).toBe('丙午');
    expect(r.late_zi).toBe(true);
    expect(r.rules_hit).toEqual(['CAL-DH', 'CAL-DH-ZI']);
  });

  it('C04：1995-03-15 00:30 → 乙巳日丙子时；两派日柱相同', () => {
    const r = computeDayHour(at('1995-03-15 00:30'));
    expect(r.day).toBe('乙巳');
    expect(r.hour).toBe('丙子');
    expect(r.zi_huanri_day_pillar).toBe('乙巳');
    expect(r.late_zi).toBe(false);
    expect(r.rules_hit).toEqual(['CAL-DH', 'CAL-DH-ZI']);
  });

  it('晚子时与次日早子时干支相同（23:00 起的子时与次日 00:00 是同一个时辰）', () => {
    const late = computeDayHour(at('1995-03-15 23:00'));
    const early = computeDayHour(at('1995-03-16 00:59'));
    expect(late.hour).toBe(early.hour);
    expect(early.day).toBe('丙午');
    expect(late.day).toBe('乙巳');
  });

  it('边界：22:59 亥时、23:00:00 子时（时干 +2），日柱都不变', () => {
    const hai = computeDayHour(at('1995-03-15 22:59'));
    const zi = computeDayHour(at('1995-03-15 23:00'));
    expect(hai.hour).toBe('丁亥');
    expect(zi.hour).toBe('戊子');
    expect(hai.day).toBe(zi.day);
    expect(hai.zi_huanri_day_pillar).toBe('乙巳');
  });

  it('非子时 rules_hit 只有 CAL-DH，alt 日柱与主结果相同', () => {
    const r = computeDayHour(at('1995-03-15 12:00'));
    expect(r.rules_hit).toEqual(['CAL-DH']);
    expect(r.zi_huanri_day_pillar).toBe(r.day);
  });

  it('癸日晚子时：时干按次日甲日起 → 甲子（跨甲子循环）', () => {
    // 找一个癸日
    let d = 1;
    while ((dayPillarOf(2000, 1, d)[0] as string) !== '癸') d++;
    const r = computeDayHour({ ...at('2000-01-01 23:10'), day: d });
    expect(r.hour).toBe('甲子');
    expect(r.zi_huanri_day_pillar[0]).toBe('甲');
  });
});

describe('真太阳时与日柱时柱', () => {
  it('C08：乌鲁木齐北京时间 2001-03-10 00:40 → 真太阳时前一日 22:19，日柱、时柱都变（辛未日己亥时）', () => {
    const corrected = chain('2001-03-10 00:40', 87.62);
    expect(corrected.tst.local.day).toBe(9);
    expect(corrected.tst.local.hour).toBe(22);
    expect(corrected.dh.day).toBe('辛未');
    expect(corrected.dh.hour).toBe('己亥');

    const uncorrected = chain('2001-03-10 00:40', null);
    expect(uncorrected.dh.day).toBe('壬申');
    expect(uncorrected.dh.hour).toBe('庚子');
    expect(uncorrected.dh.day).not.toBe(corrected.dh.day);
    expect(uncorrected.dh.hour).not.toBe(corrected.dh.hour);
  });

  it('校正后跨 23:00（北京 22:50 → 真太阳时 23:xx）：只改时柱，不改日柱', () => {
    // 哈尔滨 126.63°E，3 月中均时差约 −9 分钟：22:50 + 26.5 − 9 ≈ 23:07
    const corrected = chain('1995-03-15 22:50', 126.63);
    expect(corrected.tst.local.hour).toBe(23);
    expect(corrected.tst.local.day).toBe(15);
    const uncorrected = chain('1995-03-15 22:50', null);
    expect(uncorrected.dh.hour).toBe('丁亥');
    expect(corrected.dh.hour).toBe('戊子');
    expect(corrected.dh.day).toBe(uncorrected.dh.day);
    expect(corrected.dh.zi_huanri_day_pillar).toBe('丙午');
  });

  it('校正后倒退跨 23:00（乌鲁木齐北京 23:40 → 真太阳时约 21:21）：只改时柱，不改日柱', () => {
    const corrected = chain('1995-03-15 23:40', 87.62);
    expect(corrected.tst.local.hour).toBe(21);
    const uncorrected = chain('1995-03-15 23:40', null);
    expect(uncorrected.dh.hour).toBe('戊子');
    expect(corrected.dh.hour).toBe('丁亥');
    expect(corrected.dh.day).toBe(uncorrected.dh.day);
  });

  it('calendar.md 例：北京 00:10 → 真太阳时前一日 23:xx：日柱取前一日、子时时干按北京日期那天的日干起', () => {
    // 东经 112°：经度修正 −32 分钟，3 月中均时差约 −9 分钟，00:10 → 前一日约 23:29
    const corrected = chain('1995-03-16 00:10', 112);
    expect(corrected.tst.local.day).toBe(15);
    expect(corrected.tst.local.hour).toBe(23);
    expect(corrected.dh.day).toBe('乙巳'); // 前一日
    const beijing = computeDayHour(at('1995-03-16 00:10')); // 北京日期当天（丙午）早子时
    expect(beijing.day).toBe('丙午');
    expect(corrected.dh.hour).toBe(beijing.hour); // 戊子
  });
});

describe('cases.json：全部有时辰案例日柱、时柱、A 派日柱', () => {
  const { cases } = loadCases();
  for (const c of cases.filter((x) => x.solarDateTime !== null)) {
    it(`${c.id} ${c.title}`, () => {
      const r = chain(c.solarDateTime as string, c.birthplace?.longitude ?? null);
      expect(r.dh.day).toBe(c.expected.pillars.day);
      expect(r.dh.hour).toBe(c.expected.pillars.hour);
      const alt = c.raw.expected.alt_zi_huanri_school as { day: string } | undefined;
      if (alt) expect(r.dh.zi_huanri_day_pillar).toBe(alt.day);
    });
  }
});

describe('与 tyme4ts（Sect2）交叉校验（未校正，北京标准时间）', () => {
  /** 确定性伪随机（mulberry32），保证每次运行用例相同 */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const MIN = fromBeijingParts(at('1901-01-01 00:00'));
  const MAX = fromBeijingParts(at('2099-12-31 00:00'));

  function compare(p: DateTimeParts): string | null {
    const ours = computeDayHour(p);
    const tyme = tymePillarsAt(p);
    if (ours.day === tyme.day && ours.hour === tyme.hour) return null;
    return `${JSON.stringify(p)} ours ${ours.day}${ours.hour} tyme ${tyme.day}${tyme.hour}`;
  }

  it('随机 2,000 个时刻：日柱、时柱一致', () => {
    const r = rng(20261030);
    const bad: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const p = toBeijingParts(MIN + Math.floor(r() * (MAX - MIN)));
      const e = compare(p);
      if (e) bad.push(e);
    }
    expect(bad).toEqual([]);
  });

  it('随机 500 个 23:00–23:59 晚子时：日柱当日、时柱一致', () => {
    const r = rng(7);
    const bad: string[] = [];
    for (let i = 0; i < 500; i++) {
      const base = toBeijingParts(MIN + Math.floor(r() * (MAX - MIN)));
      const p = { ...base, hour: 23, minute: Math.floor(r() * 60), second: Math.floor(r() * 60) };
      const e = compare(p);
      if (e) bad.push(e);
    }
    expect(bad).toEqual([]);
  });

  it('连续 60 天 × 24 个整点（覆盖全部日干 × 全部时辰）一致', () => {
    const start = fromBeijingParts(at('1995-03-01 00:00'));
    const bad: string[] = [];
    for (let h = 0; h < 60 * 24; h++) {
      const e = compare(toBeijingParts(start + h * 3_600_000));
      if (e) bad.push(e);
    }
    expect(bad).toEqual([]);
  });
});
