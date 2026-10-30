/**
 * T04：CAL-YM 年柱、月柱（rules/calendar.md §1、§2）。
 * cases.json 全量对照在 cases.test.ts；这里是指名验收案例、交节边界与 tyme4ts 随机交叉校验。
 * 1950–2050 年逐个「节」边界、香港天文台抽查、lunar-javascript 差分在 jieqi.test.ts（T12）。
 */
import { describe, expect, it } from 'vitest';
import { solarTermMoment, tymePillarsAt } from '../src/bazi/calendar-adapter';
import { BaziError } from '../src/bazi/errors';
import { isGanZhi } from '../src/bazi/ganzhi';
import { fromBeijingParts, toBeijingParts } from '../src/bazi/time';
import { computeYearMonth, SUPPORTED_RANGE_UTC_MS } from '../src/bazi/year-month';
import { clockToUtc } from '../src/bazi/clock';

/** 北京标准时间 'YYYY-MM-DD HH:MM[:SS]' → Unix 毫秒 */
function bj(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(s);
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number) as number[];
  return fromBeijingParts({
    year: year as number,
    month: month as number,
    day: day as number,
    hour: hour as number,
    minute: minute as number,
    second: Number(m[6] ?? 0),
  });
}

describe('验收案例（cases.json）', () => {
  it('C01 2024-02-04 16:10（立春前 17 分钟）→ 癸卯年乙丑月', () => {
    const r = computeYearMonth(bj('2024-02-04 16:10'));
    expect([r.year, r.month]).toEqual(['癸卯', '乙丑']);
    expect(r.jieqi_prev.name).toBe('小寒');
    expect(r.jieqi_next.name).toBe('立春');
    expect(r.jieqi_next.time.slice(0, 16)).toBe('2024-02-04 16:27');
  });

  it('C02 2024-02-04 16:45（立春后 18 分钟）→ 甲辰年丙寅月', () => {
    const r = computeYearMonth(bj('2024-02-04 16:45'));
    expect([r.year, r.month]).toEqual(['甲辰', '丙寅']);
    expect(r.jieqi_prev.name).toBe('立春');
    expect(r.jieqi_prev.time.slice(0, 16)).toBe('2024-02-04 16:27');
    expect(r.jieqi_next.name).toBe('惊蛰');
  });

  it('C03 2023-01-28 10:00（春节后、立春前）→ 壬寅年癸丑月', () => {
    const r = computeYearMonth(bj('2023-01-28 10:00'));
    expect([r.year, r.month]).toEqual(['壬寅', '癸丑']);
    expect(r.jieqi_prev.name).toBe('小寒');
    expect(r.jieqi_next.name).toBe('立春');
  });

  it('C16 1994-01-09 06:45（公历 1 月）→ 癸酉年乙丑月', () => {
    const r = computeYearMonth(bj('1994-01-09 06:45'));
    expect([r.year, r.month]).toEqual(['癸酉', '乙丑']);
    expect(r.jieqi_prev.name).toBe('小寒');
  });

  it('C07 2023-04-05 08:30（清明 09:13 前）→ 乙卯月；同日 10:00 → 丙辰月', () => {
    expect(computeYearMonth(bj('2023-04-05 08:30')).month).toBe('乙卯');
    expect(computeYearMonth(bj('2023-04-05 10:00')).month).toBe('丙辰');
  });

  it('C10 夏令时钟表 1988-07-15 11:30 = 北京标准时间 10:30，年月柱戊辰、己未', () => {
    const utc = clockToUtc('1988-07-15', '11:30', 'Asia/Shanghai').utcMs;
    expect(utc).toBe(bj('1988-07-15 10:30'));
    const r = computeYearMonth(utc);
    expect([r.year, r.month]).toEqual(['戊辰', '己未']);
  });

  it('输出 rules_hit 含 CAL-YM-1、CAL-YM-2', () => {
    expect(computeYearMonth(bj('2024-02-04 16:45')).rules_hit).toEqual(['CAL-YM-1', 'CAL-YM-2']);
  });
});

describe('交节边界（绝对时刻，左闭右开）', () => {
  it('立春交节时刻本身属新年，前 1 秒属旧年', () => {
    const t = solarTermMoment(2024, 3).utcMs;
    expect(computeYearMonth(t - 1000)).toMatchObject({ year: '癸卯', month: '乙丑' });
    expect(computeYearMonth(t)).toMatchObject({ year: '甲辰', month: '丙寅' });
  });

  // 1950–2050 年每个「节」前 / 后 1 分钟的切换测试见 jieqi.test.ts（T12）。

  it('中气不换月：2024 年雨水前后同为丙寅月', () => {
    const yushui = bj('2024-02-19 12:00');
    expect(computeYearMonth(yushui - 86_400_000).month).toBe('丙寅');
    expect(computeYearMonth(yushui + 86_400_000).month).toBe('丙寅');
  });
});

describe('与 tyme4ts（Sect2）年月柱交叉校验', () => {
  // 确定性伪随机（mulberry32），保证每次运行同样的样本
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

  it('1900–2100 随机 2,000 个时刻（秒级）年柱、月柱一致', () => {
    const r = rng(20261030);
    const { min, max } = SUPPORTED_RANGE_UTC_MS;
    const bad: string[] = [];
    for (let n = 0; n < 2000; n++) {
      const t = min + Math.floor((r() * (max - min)) / 1000) * 1000;
      const ours = computeYearMonth(t);
      const theirs = tymePillarsAt(toBeijingParts(t));
      if (ours.year !== theirs.year || ours.month !== theirs.month) {
        bad.push(
          `${JSON.stringify(toBeijingParts(t))} 本项目 ${ours.year}${ours.month} / tyme ${theirs.year}${theirs.month}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });
  // 交节点前后 1 分钟与 tyme4ts / lunar-javascript 的比对见 jieqi.test.ts（T12）。
});

describe('输入范围与输出格式', () => {
  it('超出 1900–2100 年返回 E_DATE_OUT_OF_RANGE，错误信息不含输入值', () => {
    for (const t of [SUPPORTED_RANGE_UTC_MS.min - 1, SUPPORTED_RANGE_UTC_MS.max, Number.NaN]) {
      try {
        computeYearMonth(t);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(BaziError);
        expect((e as BaziError).code).toBe('E_DATE_OUT_OF_RANGE');
        expect((e as BaziError).message).not.toMatch(/\d{4}-\d{2}/);
      }
    }
  });

  it('范围两端可排：1900-01-01 00:00 → 己亥年丙子月；2100-12-31 23:59 → 庚申年戊子月', () => {
    const a = computeYearMonth(SUPPORTED_RANGE_UTC_MS.min);
    const b = computeYearMonth(SUPPORTED_RANGE_UTC_MS.max - 60_000);
    expect(isGanZhi(a.year) && isGanZhi(a.month)).toBe(true);
    expect([a.year, a.month]).toEqual(['己亥', '丙子']);
    expect([b.year, b.month]).toEqual(['庚申', '戊子']);
  });

  it('节气时刻格式为 YYYY-MM-DD HH:MM:SS；同输入两次结果深度相等', () => {
    const t = bj('1990-05-20 12:00');
    const r = computeYearMonth(t);
    expect(r.jieqi_prev.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(r.jieqi_next.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(computeYearMonth(t)).toEqual(r);
  });
});
