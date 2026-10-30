/**
 * T11：三柱模式与交节日（CAL-NOHOUR，rules/calendar.md §7）。
 * - C18（无交节、夏令时期间）、C19（当天立春交节）；
 * - 有时辰案例去掉时辰：前三柱与原案例一致、时柱为空（交节日按真实出生时刻所在一侧选 before / after）；
 * - jieqiChoice = before / after / unsure / null；12:00 不在所选一侧时取该侧时段中点；
 * - 起运按 12:00 计算并标记 approximate（「约 X 岁起运」），与真实时辰的起运日期相差不超过 4 个月。
 * cases.json 中 C18、C19 的三柱、alt 日柱由 cases.test.ts 经 computeNoHour 比对；
 * C19 的 no_hour.uncertain_year_month 与 jieqi_reference 在本文件比对（no_hour 其余字段属 T18）。
 */
import { describe, expect, it } from 'vitest';
import { clockToUtc } from '../src/bazi/clock';
import { dayPillarOf } from '../src/bazi/day-hour';
import { computeDayun } from '../src/bazi/dayun';
import { resolveSolarDate } from '../src/bazi/lunar-input';
import { computeNoHour, NO_HOUR_DEFAULT_TIME } from '../src/bazi/no-hour';
import { formatBeijing } from '../src/bazi/time';
import { computeTrueSolarTime } from '../src/bazi/true-solar-time';
import type { JieqiChoice } from '../src/bazi/types';
import { computeYearMonth } from '../src/bazi/year-month';
import { loadCases, type LoadedCase } from './helpers/cases';

const { cases } = loadCases();
const byId = (id: string): LoadedCase => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`缺少案例 ${id}`);
  return c;
};

const SH = 'Asia/Shanghai';
/** 北京标准时间 'YYYY-MM-DD HH:MM:SS' → 绝对时刻 */
const bjMs = (s: string) => Date.parse(`${s.replace(' ', 'T')}+08:00`);
const DAY_MS = 86_400_000;

describe('C18：无时辰、当天无交节（1990 年夏令时期间）', () => {
  const c = byId('C18');
  const r = computeNoHour(c.solarDate, c.raw.input.timezone, c.input.gender, c.input.jieqiChoice);

  it('只排三柱，时柱为空，hourKnown = false', () => {
    expect([r.ym.year, r.ym.month, r.day]).toEqual([
      c.expected.pillars.year,
      c.expected.pillars.month,
      c.expected.pillars.day,
    ]);
    expect(r.hour).toBeNull();
    expect(c.expected.pillars.hour).toBeNull();
    expect(r.hourKnown).toBe(false);
  });

  it('当天无交节：uncertain 为空、jieqiOnBirthday 为空', () => {
    expect(r.jieqiOnBirthday).toBeNull();
    expect(r.side).toBeNull();
    expect(r.uncertain).toEqual({ month_pillar: null, jieqi_time: null });
  });

  it('按当天 12:00 本地钟表时间计算（夏令时 UTC+9 → 03:00Z），起运标记 approximate', () => {
    expect(new Date(r.utcMs).toISOString()).toBe('1990-05-20T03:00:00.000Z');
    expect(r.dayun.dayun.approximate).toBe(true);
    expect(r.rules_hit).toContain('CAL-NOHOUR');
  });

  it('当天无交节时 jieqiChoice 不起作用', () => {
    for (const j of ['before', 'after', 'unsure'] as const) {
      expect(computeNoHour(c.solarDate, SH, c.input.gender, j)).toEqual(r);
    }
  });
});

describe('C19：无时辰、出生当天立春交节', () => {
  const c = byId('C19');
  const ref = c.raw as unknown as {
    jieqi_reference: { name: string; time_beijing: string };
    expected: { no_hour: { uncertain_year_month: [[string, string], [string, string]] } };
  };
  const run = (j: JieqiChoice | null) => computeNoHour(c.solarDate, SH, c.input.gender, j);

  it('unsure / null：按 12:00 得 癸卯 乙丑 戊戌，输出两组年月柱与交节时刻', () => {
    for (const j of ['unsure', null] as const) {
      const r = run(j);
      expect([r.ym.year, r.ym.month, r.day, r.hour]).toEqual(['癸卯', '乙丑', '戊戌', null]);
      expect(r.uncertain.month_pillar).toEqual(ref.expected.no_hour.uncertain_year_month);
      expect(r.uncertain.month_pillar).toEqual([
        ['癸卯', '乙丑'],
        ['甲辰', '丙寅'],
      ]);
      // 交节时刻来自 tyme4ts（寿星天文历）；cases.json 参考值为 PyEphem 计算，按 T12 口径允许 ≤ 1 分钟误差
      const jt = r.uncertain.jieqi_time as string;
      expect(Math.abs(bjMs(jt) - bjMs(ref.jieqi_reference.time_beijing))).toBeLessThanOrEqual(
        60_000,
      );
      expect(jt).toBe('2024-02-04 16:27:07');
      expect(r.jieqiOnBirthday).toEqual({ name: ref.jieqi_reference.name, time: jt });
      expect(r.side).toBe('before');
      expect(r.utcMs).toBe(clockToUtc(c.solarDate, NO_HOUR_DEFAULT_TIME, SH).utcMs);
    }
  });

  it('before：癸卯 乙丑（12:00 已在交节前，仍按 12:00），uncertain 为空，阴年男逆排', () => {
    const r = run('before');
    expect([r.ym.year, r.ym.month, r.day]).toEqual(['癸卯', '乙丑', '戊戌']);
    expect(r.uncertain).toEqual({ month_pillar: null, jieqi_time: null });
    expect(r.side).toBe('before');
    expect(r.utcMs).toBe(clockToUtc(c.solarDate, '12:00', SH).utcMs);
    expect(r.dayun.dayun.direction).toBe('逆');
    expect(r.dayun.dayun.steps[0]?.ganzhi).toBe('甲子');
  });

  it('after：甲辰 丙寅，按交节后时段中点计算，uncertain 为空，阳年男顺排', () => {
    const r = run('after');
    expect([r.ym.year, r.ym.month, r.day]).toEqual(['甲辰', '丙寅', '戊戌']);
    expect(r.uncertain).toEqual({ month_pillar: null, jieqi_time: null });
    expect(r.side).toBe('after');
    // 交节 16:27:07 至 24:00 的中点 = 20:13:33（取整到秒）
    expect(formatBeijing(r.utcMs)).toBe('2024-02-04 20:13:33');
    expect(r.dayun.dayun.direction).toBe('顺');
    expect(r.dayun.dayun.steps[0]?.ganzhi).toBe('丁卯');
    expect(r.dayun.dayun.approximate).toBe(true);
  });
});

describe('交节在 12:00 之前的日子（C07 当天清明 09:13）', () => {
  const date = '2023-04-05';
  it('unsure：12:00 在交节后 → 丙辰月；两组年月柱为 [癸卯 乙卯, 癸卯 丙辰]', () => {
    const r = computeNoHour(date, SH, '女', 'unsure');
    expect(r.ym.month).toBe('丙辰');
    expect(r.side).toBe('after');
    expect(r.uncertain.month_pillar).toEqual([
      ['癸卯', '乙卯'],
      ['癸卯', '丙辰'],
    ]);
    expect(r.jieqiOnBirthday?.name).toBe('清明');
    expect(r.uncertain.jieqi_time?.slice(0, 16)).toBe('2023-04-05 09:13');
  });

  it('before：取 00:00 至交节的中点，得乙卯月；after：12:00 已在交节后，仍按 12:00', () => {
    const b = computeNoHour(date, SH, '女', 'before');
    expect(b.ym.month).toBe('乙卯');
    const jie = computeYearMonth(clockToUtc(date, '12:00', SH).utcMs).jieqiPrevUtcMs;
    const start = clockToUtc(date, '00:00', SH).utcMs;
    expect(b.utcMs).toBeGreaterThanOrEqual(start);
    expect(b.utcMs).toBeLessThan(jie);
    expect(Math.abs(b.utcMs - (start + (jie - start) / 2))).toBeLessThan(1000);
    const a = computeNoHour(date, SH, '女', 'after');
    expect(a.ym.month).toBe('丙辰');
    expect(a.utcMs).toBe(clockToUtc(date, '12:00', SH).utcMs);
  });
});

describe('有时辰案例去掉时辰：前三柱一致、时柱为空', () => {
  const timed = cases.filter((c) => c.input.time !== null);
  const checked: { id: string; jieDay: boolean; tstCrossDay: boolean }[] = [];

  for (const c of timed) {
    it(`${c.id} ${c.title}`, () => {
      const { solarDate } = resolveSolarDate(c.input);
      const tz = c.raw.input.timezone;
      const realUtc = clockToUtc(solarDate, c.input.time as string, tz).utcMs;
      // 先按「不确定」排一次，看当天是否交节；交节日按真实出生时刻所在一侧选择
      const probe = computeNoHour(solarDate, tz, c.input.gender, null);
      const jieDay = probe.jieqiOnBirthday !== null;
      let r = probe;
      if (jieDay) {
        const side = realUtc < bjMs(probe.uncertain.jieqi_time as string) ? 'before' : 'after';
        r = computeNoHour(solarDate, tz, c.input.gender, side);
      }
      expect([r.ym.year, r.ym.month]).toEqual([c.expected.pillars.year, c.expected.pillars.month]);
      // 日柱：三柱模式不做真太阳时校正（没有时刻可校正），按所填日期（calendar.md §7）。
      // 真太阳时跨日的案例（如 C08 乌鲁木齐 00:40 → 前一日 22 点多）日柱按所填日期，与四柱结果不同。
      const tstDate = computeTrueSolarTime(realUtc, c.birthplace?.longitude ?? null).local;
      const [y, m, d] = solarDate.split('-').map(Number) as [number, number, number];
      const tstCrossDay = tstDate.year !== y || tstDate.month !== m || tstDate.day !== d;
      expect(r.day).toBe(dayPillarOf(y, m, d));
      if (!tstCrossDay) expect(r.day).toBe(c.expected.pillars.day);
      expect(r.hour).toBeNull();
      expect(r.hourKnown).toBe(false);
      expect(r.dayun.dayun.approximate).toBe(true);

      // 约 X 岁起运：与真实时辰的起运日期相差不超过 4 个月（12 小时 ≈ 2 个月）
      const exact = computeDayun(realUtc, c.input.gender, computeYearMonth(realUtc)).dayun;
      if (exact.direction === r.dayun.dayun.direction) {
        const diff = Math.abs(Date.parse(exact.qiyunDate) - Date.parse(r.dayun.dayun.qiyunDate));
        expect(diff / DAY_MS).toBeLessThanOrEqual(124);
      }
      checked.push({ id: c.id, jieDay, tstCrossDay });
    });
  }

  it('至少 3 个有时辰案例在三柱模式下比对通过（含交节日案例）', () => {
    expect(checked.length).toBe(timed.length);
    const sameThree = checked.filter((x) => !x.tstCrossDay);
    expect(sameThree.filter((x) => !x.jieDay).length).toBeGreaterThanOrEqual(3);
    expect(sameThree.some((x) => x.jieDay)).toBe(true);
  });
});

describe('确定性与边界', () => {
  it('同输入两次结果深度相等', () => {
    expect(computeNoHour('2024-02-04', SH, '男', null)).toEqual(
      computeNoHour('2024-02-04', SH, '男', null),
    );
  });

  it('交节日前后一天不是交节日，年柱分属两年', () => {
    // 2024-02-04 立春 16:26:56；2月3日、2月5日都不是交节日
    expect(computeNoHour('2024-02-03', SH, '男', null).jieqiOnBirthday).toBeNull();
    expect(computeNoHour('2024-02-05', SH, '男', null).jieqiOnBirthday).toBeNull();
    expect(computeNoHour('2024-02-03', SH, '男', null).ym.year).toBe('癸卯');
    expect(computeNoHour('2024-02-05', SH, '男', null).ym.year).toBe('甲辰');
  });
});
