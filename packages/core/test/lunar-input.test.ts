/**
 * T08 CAL-INPUT：农历（含闰月）→ 公历、非法日期错误码、闰月查询、错误码中文提示。
 *
 * 换算期望值来自公开万年历（香港天文台公历与农历对照表等），与 tyme4ts 无关，用于独立核对：
 * 2020 闰四月初一 = 2020-05-23、2017 闰六月初一 = 2017-07-23、2025 闰六月初一 = 2025-07-25、
 * 2023 闰二月初一 = 2023-03-22、2033 闰十一月初一 = 2033-12-22；春节 1900-01-31、1990-01-27、
 * 2000-02-05、2023-01-22、2024-02-10。
 */
import { describe, expect, it } from 'vitest';
import {
  leapMonthOf,
  lunarDayLabel,
  lunarMonthLabel,
  lunarMonthsOf,
  lunarToSolar,
  resolveSolarDate,
  validateSolarDate,
} from '../src/bazi/lunar-input';
import {
  BAZI_ERROR_MESSAGES,
  BaziError,
  baziErrorMessage,
  type BaziErrorCode,
} from '../src/bazi/errors';
import { clockToUtc } from '../src/bazi/clock';
import { computeYearMonth } from '../src/bazi/year-month';
import { computeDayHour } from '../src/bazi/day-hour';
import { computeTrueSolarTime } from '../src/bazi/true-solar-time';
import type { BirthInput } from '../src/bazi/types';
import { engineClockOf, loadCases } from './helpers/cases';

function expectError(fn: () => unknown, code: BaziErrorCode, ...forbidden: string[]): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `应抛出 ${code}`).toBeInstanceOf(BaziError);
  const err = caught as BaziError;
  expect(err.code).toBe(code);
  for (const s of forbidden) expect(err.message, '错误信息不得包含输入值').not.toContain(s);
}

const lunar = (date: string, isLeapMonth = false) =>
  resolveSolarDate({ calendar: 'lunar', date, isLeapMonth });

describe('闰月查询（表单用）', () => {
  it('有闰月的年份返回闰几月', () => {
    expect(leapMonthOf(2023)).toBe(2);
    expect(leapMonthOf(2020)).toBe(4);
    expect(leapMonthOf(2017)).toBe(6);
    expect(leapMonthOf(2025)).toBe(6);
    expect(leapMonthOf(2028)).toBe(5);
    expect(leapMonthOf(2033)).toBe(11);
    expect(leapMonthOf(1900)).toBe(8);
  });

  it('没有闰月的年份返回 null', () => {
    expect(leapMonthOf(2024)).toBeNull();
    expect(leapMonthOf(2026)).toBeNull();
    expect(leapMonthOf(2000)).toBeNull();
  });

  it('年份超出范围 → E_DATE_OUT_OF_RANGE', () => {
    expectError(() => leapMonthOf(1898), 'E_DATE_OUT_OF_RANGE', '1898');
    expectError(() => leapMonthOf(2101), 'E_DATE_OUT_OF_RANGE', '2101');
    expectError(() => leapMonthOf(2023.5), 'E_DATE_OUT_OF_RANGE');
  });

  it('月份下拉：有闰月时 13 项、闰月紧跟所闰月份；无闰月 12 项', () => {
    const m2023 = lunarMonthsOf(2023);
    expect(m2023.map((m) => m.label)).toEqual([
      '正月',
      '二月',
      '闰二月',
      '三月',
      '四月',
      '五月',
      '六月',
      '七月',
      '八月',
      '九月',
      '十月',
      '冬月',
      '腊月',
    ]);
    expect(m2023[2]).toEqual({ month: 2, isLeap: true, label: '闰二月', dayCount: 29 });
    expect(m2023[0]?.dayCount).toBe(29); // 2023 正月小
    expect(m2023[1]?.dayCount).toBe(30); // 2023 二月大
    const m2024 = lunarMonthsOf(2024);
    expect(m2024).toHaveLength(12);
    expect(m2024.some((m) => m.isLeap)).toBe(false);
  });

  it('全年天数合计 = 下一年正月初一与本年正月初一之差（1900–2099 每年）', () => {
    for (let y = 1900; y <= 2099; y++) {
      const total = lunarMonthsOf(y).reduce((s, m) => s + m.dayCount, 0);
      const a = Date.parse(lunarToSolar(y, 1, 1, false));
      const b = Date.parse(lunarToSolar(y + 1, 1, 1, false));
      expect(total, String(y)).toBe((b - a) / 86_400_000);
      expect([353, 354, 355, 383, 384, 385], String(y)).toContain(total);
    }
  });

  it('月、日名称', () => {
    expect(lunarMonthLabel(1)).toBe('正月');
    expect(lunarMonthLabel(11)).toBe('冬月');
    expect(lunarMonthLabel(12)).toBe('腊月');
    expect(lunarMonthLabel(6, true)).toBe('闰六月');
    expect([1, 9, 10, 11, 15, 19, 20, 21, 29, 30].map(lunarDayLabel)).toEqual([
      '初一',
      '初九',
      '初十',
      '十一',
      '十五',
      '十九',
      '二十',
      '廿一',
      '廿九',
      '三十',
    ]);
    expectError(() => lunarMonthLabel(13), 'E_INVALID_DATETIME');
    expectError(() => lunarDayLabel(31), 'E_INVALID_DATETIME');
  });
});

describe('农历 → 公历', () => {
  it('C07 农历 2023 闰二月十五 → 2023-04-05；C06 闰二月十八 → 2023-04-08', () => {
    expect(lunar('2023-02-15', true)).toEqual({
      solarDate: '2023-04-05',
      rules_hit: ['CAL-INPUT'],
    });
    expect(lunar('2023-02-18', true).solarDate).toBe('2023-04-08');
  });

  it('同年同数字的非闰月 ≠ 闰月：2023 二月十五 → 2023-03-06', () => {
    expect(lunar('2023-02-15').solarDate).toBe('2023-03-06');
  });

  it('闰月（≥ 3 个）', () => {
    expect(lunar('2020-04-01', true).solarDate).toBe('2020-05-23');
    expect(lunar('2017-06-01', true).solarDate).toBe('2017-07-23');
    expect(lunar('2025-06-01', true).solarDate).toBe('2025-07-25');
    expect(lunar('2023-02-01', true).solarDate).toBe('2023-03-22');
    expect(lunar('2033-11-01', true).solarDate).toBe('2033-12-22');
  });

  it('闰月大月三十合法：2017 闰六月（30 天）三十 → 2017-08-21', () => {
    expect(lunar('2017-06-30', true).solarDate).toBe('2017-08-21');
  });

  it('春节（正月初一）', () => {
    expect(lunar('1900-01-01').solarDate).toBe('1900-01-31');
    expect(lunar('1990-01-01').solarDate).toBe('1990-01-27');
    expect(lunar('2000-01-01').solarDate).toBe('2000-02-05');
    expect(lunar('2023-01-01').solarDate).toBe('2023-01-22');
    expect(lunar('2024-01-01').solarDate).toBe('2024-02-10');
  });

  it('C03 对照字段：农历癸卯年正月初七 → 2023-01-28', () => {
    expect(lunar('2023-01-07').solarDate).toBe('2023-01-28');
  });

  it('范围两端：农历 1899 腊月初一 = 1900-01-01；农历 2100 腊月初一 = 2100-12-31', () => {
    expect(lunar('1899-12-01').solarDate).toBe('1900-01-01');
    expect(lunar('2100-12-01').solarDate).toBe('2100-12-31');
  });
});

describe('非法日期 → 错误码（信息不含输入值）', () => {
  it('不存在的闰月 → E_LUNAR_NO_LEAP（≥ 3 个）', () => {
    expectError(() => lunar('2024-02-01', true), 'E_LUNAR_NO_LEAP', '2024');
    expectError(() => lunar('2023-03-01', true), 'E_LUNAR_NO_LEAP', '2023');
    expectError(() => lunar('2033-07-15', true), 'E_LUNAR_NO_LEAP', '2033');
    expectError(() => lunarToSolar(2020, 5, 1, true), 'E_LUNAR_NO_LEAP', '2020');
  });

  it('农历小月三十 → E_LUNAR_DAY_OVERFLOW（≥ 3 个，含闰月小月）', () => {
    expectError(() => lunar('2023-01-30'), 'E_LUNAR_DAY_OVERFLOW', '2023'); // 2023 正月小
    expectError(() => lunar('2023-02-30', true), 'E_LUNAR_DAY_OVERFLOW', '2023'); // 2023 闰二月小
    expectError(() => lunar('2020-04-30', true), 'E_LUNAR_DAY_OVERFLOW', '2020'); // 2020 闰四月小
    expectError(() => lunar('2025-06-30', true), 'E_LUNAR_DAY_OVERFLOW', '2025'); // 2025 闰六月小
  });

  it('农历月 / 日越界、格式错误 → E_INVALID_DATETIME', () => {
    expectError(() => lunar('2023-13-01'), 'E_INVALID_DATETIME', '2023');
    expectError(() => lunar('2023-00-01'), 'E_INVALID_DATETIME');
    expectError(() => lunar('2023-02-31'), 'E_INVALID_DATETIME');
    expectError(() => lunar('2023-02-00'), 'E_INVALID_DATETIME');
    expectError(() => lunar('2023-2-1'), 'E_INVALID_DATETIME', '2023');
  });

  it('公历不存在的日期 → E_INVALID_DATETIME（≥ 3 个）', () => {
    const solar = (date: string) => resolveSolarDate({ calendar: 'solar', date });
    expectError(() => solar('2023-02-30'), 'E_INVALID_DATETIME', '2023');
    expectError(() => solar('2023-02-29'), 'E_INVALID_DATETIME', '2023'); // 平年
    expectError(() => solar('1900-02-29'), 'E_INVALID_DATETIME', '1900'); // 整百非闰
    expectError(() => solar('2100-02-29'), 'E_INVALID_DATETIME', '2100');
    expectError(() => solar('2023-04-31'), 'E_INVALID_DATETIME');
    expectError(() => solar('2023-13-01'), 'E_INVALID_DATETIME');
    expectError(() => solar('20230101'), 'E_INVALID_DATETIME');
    expect(solar('2000-02-29')).toEqual({ solarDate: '2000-02-29', rules_hit: [] }); // 世纪闰年
  });

  it('公历输入标记闰月 → E_INVALID_DATETIME', () => {
    expectError(
      () => resolveSolarDate({ calendar: 'solar', date: '2023-04-05', isLeapMonth: true }),
      'E_INVALID_DATETIME',
    );
  });

  it('超出 1900–2100 → E_DATE_OUT_OF_RANGE', () => {
    expectError(() => validateSolarDate('1899-12-31'), 'E_DATE_OUT_OF_RANGE', '1899');
    expectError(() => validateSolarDate('2101-01-01'), 'E_DATE_OUT_OF_RANGE', '2101');
    expectError(() => lunar('1899-11-29'), 'E_DATE_OUT_OF_RANGE', '1899'); // 公历 1899 年
    expectError(() => lunar('2100-12-02'), 'E_DATE_OUT_OF_RANGE', '2100-12', '2101'); // 公历 2101-01-01
    expectError(() => lunar('1898-06-01'), 'E_DATE_OUT_OF_RANGE', '1898');
    expect(validateSolarDate('1900-01-01')).toBe('1900-01-01');
    expect(validateSolarDate('2100-12-31')).toBe('2100-12-31');
  });

  it('未知历法 → E_INVALID_DATETIME', () => {
    expectError(
      () => resolveSolarDate({ calendar: 'hijri' as BirthInput['calendar'], date: '2023-01-01' }),
      'E_INVALID_DATETIME',
    );
  });
});

describe('错误码中文提示映射', () => {
  const codes: BaziErrorCode[] = [
    'E_DATE_OUT_OF_RANGE',
    'E_INVALID_DATETIME',
    'E_INVALID_TIMEZONE',
    'E_DST_GAP',
    'E_INVALID_LONGITUDE',
    'E_LUNAR_NO_LEAP',
    'E_LUNAR_DAY_OVERFLOW',
    'E_INVALID_INPUT',
    'E_UNKNOWN_PLACE',
    'E_INVALID_REF_DATE',
  ];

  it('每个错误码都有中文提示，且映射表没有多余键', () => {
    expect(Object.keys(BAZI_ERROR_MESSAGES).sort()).toEqual([...codes].sort());
    for (const c of codes) {
      expect(baziErrorMessage(c)).toMatch(/[一-鿿]/);
      expect(baziErrorMessage(c).length).toBeGreaterThan(5);
    }
  });

  it('闰月 / 小月提示语义正确', () => {
    expect(baziErrorMessage('E_LUNAR_NO_LEAP')).toContain('闰月');
    expect(baziErrorMessage('E_LUNAR_DAY_OVERFLOW')).toContain('小月');
  });
});

describe('cases.json：农历换算结果与案例给出的公历日期一致', () => {
  const { cases } = loadCases();
  for (const c of cases) {
    it(`${c.id} ${c.input.calendar === 'lunar' ? '农历' : '公历'}输入 → ${c.solarDate}`, () => {
      const r = resolveSolarDate(c.input);
      expect(r.solarDate).toBe(c.solarDate);
      expect(r.rules_hit).toEqual(c.input.calendar === 'lunar' ? ['CAL-INPUT'] : []);
      if (c.solarDateTime !== null) expect(engineClockOf(c)).toBe(c.solarDateTime);
    });
  }

  it('至少包含 C06、C07 两个农历闰月案例', () => {
    const leap = cases.filter((c) => c.input.calendar === 'lunar' && c.input.isLeapMonth === true);
    expect(leap.map((c) => c.id)).toEqual(expect.arrayContaining(['C06', 'C07']));
  });
});

describe('C07 全链：农历闰二月十五 08:30 → 公历 → 四柱', () => {
  const chainOf = (time: string) => {
    const { solarDate } = lunar('2023-02-15', true);
    const { utcMs } = clockToUtc(solarDate, time);
    const ym = computeYearMonth(utcMs);
    const dh = computeDayHour(computeTrueSolarTime(utcMs, null).local);
    return { ym, dh };
  };

  it('08:30 在清明（09:13）前 → 癸卯年乙卯月', () => {
    const { ym, dh } = chainOf('08:30');
    expect([ym.year, ym.month]).toEqual(['癸卯', '乙卯']);
    expect(ym.jieqi_next.name).toBe('清明');
    const c07 = loadCases().cases.find((c) => c.id === 'C07');
    expect(c07).toBeDefined();
    expect([ym.year, ym.month, dh.day, dh.hour]).toEqual([
      c07?.expected.pillars.year,
      c07?.expected.pillars.month,
      c07?.expected.pillars.day,
      c07?.expected.pillars.hour,
    ]);
  });

  it('同一天 10:00 → 丙辰月（闰月不等于某个月柱）', () => {
    expect(chainOf('10:00').ym.month).toBe('丙辰');
  });
});
