/**
 * T06：CAL-TST 真太阳时（rules/calendar.md §4）。
 * - NOAA 均时差全年极值（名义值 −14.2 / +16.4 分钟；NOAA 近似式本身误差 < 1 分钟，这里要求与名义值相差 < 0.1 分钟）。
 * - cases.json：有出生地的案例（C08、C09）比对 derived 的真太阳时、经度修正、均时差；
 *   没有出生地的案例一律 tst_status = 未校正、true_solar_time = null、当地时间 = 北京标准时间。
 * - 未校正时离时辰边界 < 30 分钟的提示标记（按北京标准时间判断，夏令时期间先换成标准时）。
 * - 测试用出生地代码与临时地区表（core/geo）一致。
 */
import { describe, expect, it } from 'vitest';
import { IANAZone } from 'luxon';
import { clockToUtc } from '../src/bazi/clock';
import { BaziError } from '../src/bazi/errors';
import { formatBeijing } from '../src/bazi/time';
import {
  computeTrueSolarTime,
  equationOfTimeMinutes,
  longitudeCorrectionMinutes,
  minutesToShichenBoundary,
} from '../src/bazi/true-solar-time';
import { findPlace, listPlaces } from '../src/geo';
import { engineClockOf, loadCases, TEST_PLACE_CODES } from './helpers/cases';

const split = (s: string): [string, string] => s.split(' ') as [string, string];
const utcOf = (s: string, tz = 'Asia/Shanghai') => clockToUtc(...split(s), tz).utcMs;
/** 时辰地支序号：子 0、丑 1 … 亥 11 */
const shichen = (hour: number) => Math.floor((hour + 1) / 2) % 12;

describe('NOAA 均时差', () => {
  for (const year of [2001, 2024]) {
    it(`${year} 年逐小时扫描：极值约 −14.2（2 月）与 +16.4（11 月初）分钟`, () => {
      let min = { v: Infinity, t: 0 };
      let max = { v: -Infinity, t: 0 };
      const start = Date.UTC(year, 0, 1);
      const end = Date.UTC(year + 1, 0, 1);
      for (let t = start; t < end; t += 3_600_000) {
        const v = equationOfTimeMinutes(t);
        if (v < min.v) min = { v, t };
        if (v > max.v) max = { v, t };
      }
      expect(Math.abs(min.v - -14.2)).toBeLessThan(0.1);
      expect(Math.abs(max.v - 16.4)).toBeLessThan(0.1);
      expect(new Date(min.t).getUTCMonth()).toBe(1); // 2 月
      const maxMonth = new Date(max.t).getUTCMonth();
      expect(maxMonth === 9 || maxMonth === 10).toBe(true); // 10 月底 / 11 月初
    });
  }

  it('四个过零点附近（4 月中、6 月中、9 月初、12 月下旬）绝对值 < 1 分钟', () => {
    for (const d of ['2001-04-15', '2001-06-13', '2001-09-01', '2001-12-25']) {
      expect(Math.abs(equationOfTimeMinutes(Date.parse(`${d}T12:00:00Z`)))).toBeLessThan(1);
    }
  });

  it('经度修正 = (经度 − 120) × 4 分钟', () => {
    expect(longitudeCorrectionMinutes(120)).toBe(0);
    expect(longitudeCorrectionMinutes(87.62)).toBeCloseTo(-129.52, 10);
    expect(longitudeCorrectionMinutes(126.63)).toBeCloseTo(26.52, 10);
  });
});

describe('cases.json 真太阳时对照', () => {
  const { cases } = loadCases();
  for (const c of cases) {
    const clock = engineClockOf(c);
    const derived = (c.raw.derived ?? {}) as Record<string, unknown>;
    const utcMs = utcOf(clock, c.raw.input.timezone);

    if (c.birthplace === null) {
      it(`${c.id} 未选出生地 → 未校正，按北京标准时间`, () => {
        const r = computeTrueSolarTime(utcMs, null);
        expect(r.tst_status).toBe('未校正');
        expect(r.true_solar_time).toBeNull();
        expect(r.rules_hit).toContain('CAL-TST');
        expect(formatBeijing(utcMs)).toBe(
          `${r.local.year}-${String(r.local.month).padStart(2, '0')}-${String(r.local.day).padStart(2, '0')} ` +
            `${String(r.local.hour).padStart(2, '0')}:${String(r.local.minute).padStart(2, '0')}:00`,
        );
      });
      continue;
    }

    const birthplace = c.birthplace;
    it(`${c.id} ${c.title}：真太阳时 ${String(derived.true_solar_time)}`, () => {
      const r = computeTrueSolarTime(utcMs, birthplace.longitude);
      expect(r.tst_status).toBe('已校正');
      expect(r.near_shichen_boundary).toBe(false);
      const tst = r.true_solar_time;
      expect(tst).not.toBeNull();
      if (!tst) return;
      expect(tst.beijingTime).toBe(derived.beijing_standard_time);
      expect(tst.trueSolarTime).toBe(derived.true_solar_time);
      expect(tst.longitudeCorrectionMin).toBe(derived.longitude_correction_min);
      // 与 cases.json 同一公式：±0.01 分钟（四舍五入差异）；与 PyEphem 精确值：< 1 分钟（NOAA 近似误差）
      expect(
        Math.abs(tst.equationOfTimeMin - (derived.equation_of_time_min as number)),
      ).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(
        Math.abs(equationOfTimeMinutes(utcMs) - (derived.equation_of_time_min_ephem as number)),
      ).toBeLessThan(1);
    });
  }

  it('C08 乌鲁木齐北京时间 00:40 → 真太阳时前一日 22:19（跨午夜，时辰由子变亥）', () => {
    const utcMs = utcOf('2001-03-10 00:40');
    const r = computeTrueSolarTime(utcMs, 87.62);
    expect(r.local).toMatchObject({ year: 2001, month: 3, day: 9, hour: 22, minute: 19 });
    expect(shichen(r.local.hour)).toBe(11); // 亥
    const plain = computeTrueSolarTime(utcMs, null);
    expect(plain.local).toMatchObject({ day: 10, hour: 0, minute: 40 });
    expect(shichen(plain.local.hour)).toBe(0); // 子
  });

  it('C09 哈尔滨北京时间 06:50 → 真太阳时 07:32（卯时变辰时，日期不变）', () => {
    const utcMs = utcOf('1990-11-03 06:50');
    const r = computeTrueSolarTime(utcMs, 126.63);
    expect(r.local).toMatchObject({ year: 1990, month: 11, day: 3, hour: 7, minute: 32 });
    expect(shichen(r.local.hour)).toBe(4); // 辰
    expect(shichen(computeTrueSolarTime(utcMs, null).local.hour)).toBe(3); // 卯
  });
});

describe('未校正：离时辰边界 < 30 分钟提示', () => {
  const near = (s: string) => computeTrueSolarTime(utcOf(s), null).near_shichen_boundary;

  it('边界前后', () => {
    const cases: [string, boolean][] = [
      ['2024-05-01 06:29', false],
      ['2024-05-01 06:30', false],
      ['2024-05-01 06:31', true],
      ['2024-05-01 06:59', true],
      ['2024-05-01 07:00', true],
      ['2024-05-01 07:29', true],
      ['2024-05-01 07:30', false],
      ['2024-05-01 08:00', false],
      ['2024-05-01 22:45', true],
      ['2024-05-01 23:20', true],
      ['2024-05-01 00:10', false],
      ['2024-05-01 00:40', true],
      ['2024-05-01 12:00', false],
    ];
    for (const [s, want] of cases) expect(near(s), s).toBe(want);
  });

  it('夏令时期间按标准时间判断：1990-07-01 钟表 12:20 = 标准时 11:20 → 提示', () => {
    expect(near('1990-07-01 12:20')).toBe(true);
    expect(near('1991-12-01 12:20')).toBe(false);
  });

  it('已校正时不输出提示标记', () => {
    expect(computeTrueSolarTime(utcOf('2024-05-01 06:59'), 120).near_shichen_boundary).toBe(false);
  });

  it('minutesToShichenBoundary', () => {
    const at = (h: number, m: number) => Date.UTC(2000, 0, 1, h, m);
    expect(minutesToShichenBoundary(at(23, 0))).toBe(0);
    expect(minutesToShichenBoundary(at(0, 0))).toBe(60);
    expect(minutesToShichenBoundary(at(1, 15))).toBe(15);
    expect(minutesToShichenBoundary(at(22, 50))).toBe(10);
  });
});

describe('其他', () => {
  it('东经 120° 只差均时差；跨 23:00 不跨午夜时日期不变', () => {
    const utcMs = utcOf('2001-03-09 23:10');
    const r = computeTrueSolarTime(utcMs, 120);
    expect(r.true_solar_time?.longitudeCorrectionMin).toBe(0);
    expect(r.true_solar_time?.trueSolarTime).toBe('2001-03-09 22:58'); // 23:10 − 11.19 分（NOAA）
    expect(r.local.day).toBe(9);
  });

  it('海外：纽约 2024-07-01 12:00（EDT）→ 真太阳时约 11:00', () => {
    const utcMs = utcOf('2024-07-01 12:00', 'America/New_York');
    const r = computeTrueSolarTime(utcMs, -74.01);
    expect(r.true_solar_time?.beijingTime).toBe('2024-07-02 00:00');
    expect(r.local).toMatchObject({ year: 2024, month: 7, day: 1, hour: 11 });
    expect(r.local.minute).toBeLessThan(5);
  });

  it('同一输入多次计算结果完全相同', () => {
    const utcMs = utcOf('2001-03-10 00:40');
    expect(computeTrueSolarTime(utcMs, 87.62)).toEqual(computeTrueSolarTime(utcMs, 87.62));
  });

  it('非法经度 → E_INVALID_LONGITUDE，信息不含输入值', () => {
    for (const lon of [NaN, Infinity, 180.5, -200]) {
      let err: unknown;
      try {
        computeTrueSolarTime(0, lon);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BaziError);
      expect((err as BaziError).code).toBe('E_INVALID_LONGITUDE');
      expect((err as BaziError).message).not.toMatch(/\d/);
    }
  });
});

describe('临时地区表（core/geo，正式表见 T40）', () => {
  it('测试用出生地代码都能查到，经度与 cases.json 一致', () => {
    for (const [name, { code, longitude }] of Object.entries(TEST_PLACE_CODES)) {
      const p = findPlace(code);
      expect(p, name).not.toBeNull();
      expect(p?.longitude).toBe(longitude);
    }
  });

  it('代码唯一、6 位数字；经度在范围内且精度 0.01°；时区有效', () => {
    const places = listPlaces();
    expect(new Set(places.map((p) => p.code)).size).toBe(places.length);
    for (const p of places) {
      expect(p.code).toMatch(/^\d{6}$/);
      expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);
      expect(Math.round(p.longitude * 100) / 100).toBe(p.longitude);
      expect(IANAZone.isValidZone(p.timezone)).toBe(true);
    }
    expect(findPlace('000000')).toBeNull();
  });
});
