/**
 * T05：CAL-TZ 本地钟表时间 → UTC（rules/calendar.md §5）。
 * - 1986–1991 每年夏令时起止前后；1988 年开始日以 tzdata 为准（04-17，不是 04-10）。
 * - 重复时刻取较晚一次并置 dstAmbiguous；不存在时刻抛 E_DST_GAP；错误信息不含输入值。
 * - 海外时区；cases.json 全部案例的 derived（utc_offset_hours、beijing_standard_time）。
 */
import { describe, expect, it } from 'vitest';
import { clockToUtc, DEFAULT_TIMEZONE } from '../src/bazi/clock';
import { BaziError } from '../src/bazi/errors';
import { computeYearMonth } from '../src/bazi/year-month';
import { formatBeijing } from '../src/bazi/time';
import { engineClockOf, loadCases } from './helpers/cases';

const SH = 'Asia/Shanghai';

/** 'YYYY-MM-DD HH:MM' → [date, time] */
const split = (s: string): [string, string] => s.split(' ') as [string, string];
const conv = (s: string, tz = SH) => clockToUtc(...split(s), tz);
/** 换算结果的 UTC 偏移（小时）与北京标准时间 'YYYY-MM-DD HH:MM' */
const brief = (s: string, tz = SH) => {
  const r = conv(s, tz);
  return {
    offsetH: r.clock_to_utc.utcOffsetMinutes / 60,
    bj: formatBeijing(r.utcMs).slice(0, 16),
    ambiguous: r.clock_to_utc.dstAmbiguous,
  };
};

function expectError(fn: () => unknown, code: string, ...forbidden: string[]) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(BaziError);
  const be = err as BaziError;
  expect(be.code).toBe(code);
  for (const f of forbidden) expect(be.message).not.toContain(f);
  expect(be.message).not.toMatch(/\d/);
}

/** 1986–1991 中国夏令时起止日（当地钟表日期）。calendar.md §5 表格，1988 开始日按 tzdata。 */
const DST = [
  { year: 1986, start: '1986-05-04', end: '1986-09-14' },
  { year: 1987, start: '1987-04-12', end: '1987-09-13' },
  { year: 1988, start: '1988-04-17', end: '1988-09-11' },
  { year: 1989, start: '1989-04-16', end: '1989-09-17' },
  { year: 1990, start: '1990-04-15', end: '1990-09-16' },
  { year: 1991, start: '1991-04-14', end: '1991-09-15' },
];

describe('CAL-TZ 基本换算', () => {
  it('默认时区是 Asia/Shanghai', () => {
    expect(DEFAULT_TIMEZONE).toBe(SH);
    const r = clockToUtc('2024-02-04', '16:45');
    expect(r.clock_to_utc).toEqual({
      utc: '2024-02-04T08:45:00Z',
      timezone: SH,
      utcOffsetMinutes: 480,
      dstAmbiguous: false,
    });
    expect(r.utcMs).toBe(Date.UTC(2024, 1, 4, 8, 45));
    expect(r.rules_hit).toEqual(['CAL-TZ']);
  });

  it('C10：1988-07-15 11:30（夏令时）→ UTC+9，北京标准时间 10:30，年月柱戊辰、己未', () => {
    const r = conv('1988-07-15 11:30');
    expect(r.clock_to_utc.utc).toBe('1988-07-15T02:30:00Z');
    expect(r.clock_to_utc.utcOffsetMinutes).toBe(540);
    expect(formatBeijing(r.utcMs)).toBe('1988-07-15 10:30:00');
    const ym = computeYearMonth(r.utcMs);
    expect([ym.year, ym.month]).toEqual(['戊辰', '己未']);
  });

  it('同输入两次结果深度相等（确定性）', () => {
    expect(conv('1986-09-14 01:30')).toEqual(conv('1986-09-14 01:30'));
  });

  it('1992 年起不再有夏令时', () => {
    expect(brief('1992-07-15 12:00').offsetH).toBe(8);
  });

  it('1949 年以前的夏令时由 tzdata 覆盖（1947-07-01 为 UTC+9）', () => {
    expect(brief('1947-07-01 12:00').offsetH).toBe(9);
  });
});

describe('1986–1991 夏令时起止前后', () => {
  for (const { year, start, end } of DST) {
    describe(String(year), () => {
      it(`开始日 ${start}：01:59 为 +8，03:00 为 +9`, () => {
        expect(brief(`${start} 01:59`)).toMatchObject({ offsetH: 8, bj: `${start} 01:59` });
        expect(brief(`${start} 03:00`)).toMatchObject({ offsetH: 9, bj: `${start} 02:00` });
      });

      it(`开始日 ${start}：02:00、02:30、02:59 不存在 → E_DST_GAP`, () => {
        for (const t of ['02:00', '02:30', '02:59'])
          expectError(() => conv(`${start} ${t}`), 'E_DST_GAP');
      });

      it(`结束日 ${end}：00:59 为 +9，02:00 为 +8`, () => {
        expect(brief(`${end} 00:59`)).toMatchObject({ offsetH: 9, ambiguous: false });
        expect(brief(`${end} 02:00`)).toMatchObject({
          offsetH: 8,
          bj: `${end} 02:00`,
          ambiguous: false,
        });
      });

      it(`结束日 ${end}：01:00、01:30、01:59 重复 → 取较晚一次（+8 标准时间）并标记`, () => {
        for (const t of ['01:00', '01:30', '01:59']) {
          expect(brief(`${end} ${t}`)).toEqual({ offsetH: 8, bj: `${end} ${t}`, ambiguous: true });
        }
      });

      it(`夏令时期间（${year}-07-01 12:00）为 +9`, () => {
        expect(brief(`${year}-07-01 12:00`)).toMatchObject({
          offsetH: 9,
          bj: `${year}-07-01 11:00`,
        });
      });
    });
  }

  it('1988 年以 tzdata 为准：04-10 02:30 存在且为 +8（部分资料所说的 04-10 不采用）', () => {
    expect(brief('1988-04-10 02:30')).toEqual({
      offsetH: 8,
      bj: '1988-04-10 02:30',
      ambiguous: false,
    });
    expect(brief('1988-04-16 12:00').offsetH).toBe(8);
    expect(brief('1988-04-17 12:00').offsetH).toBe(9);
  });

  it('重复时刻：结果确实是两种解释中较晚的那一个（比 +9 解释晚 1 小时）', () => {
    const r = conv('1990-09-16 01:30');
    expect(r.utcMs).toBe(Date.UTC(1990, 8, 15, 17, 30));
    expect(r.utcMs - Date.UTC(1990, 8, 15, 16, 30)).toBe(3_600_000);
  });
});

describe('海外时区', () => {
  it('America/New_York 2024-07-04 09:00（EDT，UTC−4）→ 13:00Z', () => {
    const r = conv('2024-07-04 09:00', 'America/New_York');
    expect(r.clock_to_utc).toEqual({
      utc: '2024-07-04T13:00:00Z',
      timezone: 'America/New_York',
      utcOffsetMinutes: -240,
      dstAmbiguous: false,
    });
  });

  it('America/New_York 冬令（EST，UTC−5）', () => {
    expect(conv('2024-01-15 09:00', 'America/New_York').clock_to_utc.utc).toBe(
      '2024-01-15T14:00:00Z',
    );
  });

  it('America/New_York 2024-03-10 02:30 不存在 → E_DST_GAP；2024-11-03 01:30 重复 → 取 EST', () => {
    expectError(() => conv('2024-03-10 02:30', 'America/New_York'), 'E_DST_GAP');
    const r = conv('2024-11-03 01:30', 'America/New_York');
    expect(r.clock_to_utc).toMatchObject({
      utc: '2024-11-03T06:30:00Z',
      utcOffsetMinutes: -300,
      dstAmbiguous: true,
    });
  });

  it('Asia/Kolkata 半小时偏移（UTC+5:30）', () => {
    expect(conv('2000-01-01 05:30', 'Asia/Kolkata').clock_to_utc).toMatchObject({
      utc: '2000-01-01T00:00:00Z',
      utcOffsetMinutes: 330,
    });
  });

  it('跨日：Europe/London 2024-01-01 00:30 → 北京时间 2024-01-01 08:30；Pacific/Auckland 00:30 → 前一日', () => {
    expect(brief('2024-01-01 00:30', 'Europe/London').bj).toBe('2024-01-01 08:30');
    expect(brief('2024-01-01 00:30', 'Pacific/Auckland').bj).toBe('2023-12-31 19:30');
  });
});

describe('错误码（信息不含输入值）', () => {
  it('无效时区 → E_INVALID_TIMEZONE', () => {
    expectError(
      () => clockToUtc('2024-01-01', '12:00', 'Mars/Olympus'),
      'E_INVALID_TIMEZONE',
      'Mars',
    );
  });

  it('格式错误 / 不存在的日期时间 → E_INVALID_DATETIME', () => {
    const bad: [string, string][] = [
      ['2024-02-30', '12:00'],
      ['2023-02-29', '12:00'],
      ['2024-13-01', '12:00'],
      ['2024-01-01', '24:00'],
      ['2024-01-01', '12:60'],
      ['2024/01/01', '12:00'],
      ['2024-01-01', '9:00'],
    ];
    for (const [d, t] of bad) expectError(() => clockToUtc(d, t), 'E_INVALID_DATETIME', d, t);
  });

  it('E_DST_GAP 信息不含输入值', () => {
    expectError(() => conv('1991-04-14 02:15'), 'E_DST_GAP', '1991', '02:15');
  });
});

describe('cases.json derived 对照（utc_offset_hours、beijing_standard_time）', () => {
  const { cases } = loadCases();
  for (const c of cases) {
    const derived = c.raw.derived as Record<string, unknown> | undefined;
    if (!derived) continue;
    it(`${c.id} ${c.title}`, () => {
      // 农历案例走 CAL-INPUT 换算；无时辰案例按 cases.json 约定的 12:00 本地钟表时间
      const clock = engineClockOf(c);
      const r = brief(clock, c.raw.input.timezone);
      expect(r.offsetH).toBe(derived.utc_offset_hours);
      if (derived.beijing_standard_time != null) expect(r.bj).toBe(derived.beijing_standard_time);
    });
  }
});
