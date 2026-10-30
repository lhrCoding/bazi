/**
 * T10：流年表与参考日期（rules/calendar.md §8 末条、report-sections.md §8.2）。
 * - 起始年 = 参考日期所在干支年（立春为界，交节时刻本身属新年），连续 5 年。
 * - 参考日期在立春前后各一个用例；同一出生信息、不同 refDate 起始年不同；流年年份与干支一一对应。
 * - 所在大运：流年跨两步大运时取立春交节时刻所在的那一步；尚未起运为 null；
 *   超出 8 步按顺逆规则继续推第 9 步及以后（高龄用户）。
 * cases.json 中没有流年期望字段（流年随参考日期变化），故只有本文件的用例，无 PENDING_FIELDS 变动。
 */
import { describe, expect, it } from 'vitest';
import { tymePillarsAt } from '../src/bazi/calendar-adapter';
import { clockToUtc } from '../src/bazi/clock';
import { computeDayun, dayunStepGanzhi } from '../src/bazi/dayun';
import { ganZhiAt, ganZhiIndex, type GanZhi } from '../src/bazi/ganzhi';
import {
  computeLiunian,
  dayunAtBeijing,
  lichunUtcMs,
  liunianStartYear,
  LIUNIAN_YEAR_COUNT,
} from '../src/bazi/liunian';
import { resolveSolarDate } from '../src/bazi/lunar-input';
import { formatBeijing, fromBeijingParts, toBeijingParts } from '../src/bazi/time';
import type { Dayun, Gender } from '../src/bazi/types';
import { computeYearMonth } from '../src/bazi/year-month';
import { engineClockOf, loadCases } from './helpers/cases';

/** 北京时间（中国大陆 1992 年以后无夏令时）→ 绝对时刻 */
const bj = (date: string, time: string) => clockToUtc(date, time, 'Asia/Shanghai').utcMs;

function dayunOf(date: string, time: string, gender: Gender): Dayun {
  const utcMs = bj(date, time);
  return computeDayun(utcMs, gender, computeYearMonth(utcMs)).dayun;
}

// C01 出生信息：2024-02-04 16:10 男，逆排，起运 2033-12-01 08:10，大运 甲子 2033、癸亥 2043 ……
const C01_DAYUN = dayunOf('2024-02-04', '16:10', '男');

describe('起始年：参考日期所在干支年（立春为界）', () => {
  it('参考日期在立春之后：2026-10-29 → 2026 丙午年起', () => {
    const ln = computeLiunian(bj('2026-10-29', '12:00'), C01_DAYUN);
    expect(ln.map((x) => x.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(ln.map((x) => x.ganzhi)).toEqual(['丙午', '丁未', '戊申', '己酉', '庚戌']);
  });

  it('参考日期在立春之前：2026-01-20 → 仍属 2025 乙巳年', () => {
    const ln = computeLiunian(bj('2026-01-20', '12:00'), C01_DAYUN);
    expect(ln[0]).toMatchObject({ year: 2025, ganzhi: '乙巳' });
    expect(ln.map((x) => x.year)).toEqual([2025, 2026, 2027, 2028, 2029]);
  });

  it('立春交节时刻前 1 秒属上一年，交节时刻本身及之后属新年（2026 立春 04:02:08）', () => {
    const t = lichunUtcMs(2026);
    expect(formatBeijing(t)).toBe('2026-02-04 04:02:08');
    expect(liunianStartYear(t - 1000)).toBe(2025);
    expect(liunianStartYear(t)).toBe(2026);
    expect(liunianStartYear(t + 1000)).toBe(2026);
    // 立春当天、交节之前（同一公历日）仍属上一年
    expect(liunianStartYear(bj('2026-02-04', '03:00'))).toBe(2025);
    expect(liunianStartYear(bj('2026-02-04', '05:00'))).toBe(2026);
  });

  it('元旦到立春之间属上一年，公历年末属当年', () => {
    expect(liunianStartYear(bj('2027-01-01', '00:00'))).toBe(2026);
    expect(liunianStartYear(bj('2026-12-31', '23:59'))).toBe(2026);
  });

  it('同一出生信息、不同 refDate → 起始年不同，出生信息相同的部分（大运）不变', () => {
    const a = computeLiunian(bj('2026-10-29', '12:00'), C01_DAYUN);
    const b = computeLiunian(bj('2034-06-01', '12:00'), C01_DAYUN);
    expect(a[0]?.year).toBe(2026);
    expect(b[0]?.year).toBe(2034);
    expect(b[0]?.dayun).toBe('甲子');
  });

  it('同一 refDate（如订单创建时间）重复计算，结果深度相等', () => {
    const ref = bj('2026-10-29', '15:30');
    expect(computeLiunian(ref, C01_DAYUN)).toEqual(computeLiunian(ref, C01_DAYUN));
  });

  it('默认 5 年，可指定年数', () => {
    expect(LIUNIAN_YEAR_COUNT).toBe(5);
    expect(computeLiunian(bj('2026-10-29', '12:00'), C01_DAYUN)).toHaveLength(5);
    expect(computeLiunian(bj('2026-10-29', '12:00'), C01_DAYUN, 10)).toHaveLength(10);
  });

  it('参考日期非法时报错', () => {
    expect(() => liunianStartYear(Number.NaN)).toThrow();
    expect(() =>
      liunianStartYear(
        fromBeijingParts({ year: 1899, month: 6, day: 1, hour: 0, minute: 0, second: 0 }),
      ),
    ).toThrow();
    expect(() =>
      liunianStartYear(
        fromBeijingParts({ year: 2101, month: 6, day: 1, hour: 0, minute: 0, second: 0 }),
      ),
    ).toThrow();
  });
});

describe('流年年份与干支一一对应', () => {
  it('锚点：1984 甲子、2024 甲辰、2027 丁未（calendar.md §8 示例）、1900 庚子、2100 庚申', () => {
    const at = (y: number) =>
      computeLiunian(
        fromBeijingParts({ year: y, month: 6, day: 1, hour: 0, minute: 0, second: 0 }),
        C01_DAYUN,
        1,
      )[0]?.ganzhi;
    expect(at(1984)).toBe('甲子');
    expect(at(2024)).toBe('甲辰');
    expect(at(2027)).toBe('丁未');
    expect(at(1900)).toBe('庚子');
    expect(at(2100)).toBe('庚申');
  });

  it('1900–2100 每年：干支 = 立春交节时刻起的年柱（year-month.ts 与 tyme4ts 双重校验），交节前 1 秒为上一年', () => {
    const ln = computeLiunian(
      fromBeijingParts({ year: 1900, month: 6, day: 1, hour: 0, minute: 0, second: 0 }),
      C01_DAYUN,
      201,
    );
    let prev: GanZhi | null = null;
    ln.forEach((x, i) => {
      expect(x.year).toBe(1900 + i);
      const t = lichunUtcMs(x.year);
      expect(x.lichun).toBe(formatBeijing(t));
      expect(computeYearMonth(t).year).toBe(x.ganzhi);
      expect(tymePillarsAt(toBeijingParts(t + 60_000)).year).toBe(x.ganzhi);
      if (x.year > 1900) expect(computeYearMonth(t - 1000).year).toBe(prev);
      // 相邻年份干支序号 +1（60 年一轮）
      if (prev !== null) expect((ganZhiIndex(prev) + 1) % 60).toBe(ganZhiIndex(x.ganzhi));
      prev = x.ganzhi;
    });
    // 60 年内互不相同
    expect(new Set(ln.slice(0, 60).map((x) => x.ganzhi)).size).toBe(60);
  });

  it('立春时刻落在公历 2 月 3–5 日', () => {
    for (let y = 1900; y <= 2104; y++) {
      const p = toBeijingParts(lichunUtcMs(y));
      expect(p.month).toBe(2);
      expect(p.day).toBeGreaterThanOrEqual(3);
      expect(p.day).toBeLessThanOrEqual(5);
    }
  });
});

describe('所在大运（立春交节时刻所在的那一步）', () => {
  it('C01：起运（2033-12-01）之前的流年为 null；起运当年立春仍未起运', () => {
    expect(C01_DAYUN.qiyunTime).toBe('2033-12-01 08:10');
    const ln = computeLiunian(bj('2031-06-01', '12:00'), C01_DAYUN);
    expect(ln.map((x) => [x.year, x.dayun])).toEqual([
      [2031, null],
      [2032, null],
      [2033, null], // 2033 立春 2033-02-03，早于起运 2033-12-01
      [2034, '甲子'],
      [2035, '甲子'],
    ]);
  });

  it('C01：跨两步大运的流年取立春所在一步（2043 立春在 2043-12-01 换运之前 → 仍为甲子）', () => {
    const ln = computeLiunian(bj('2042-06-01', '12:00'), C01_DAYUN);
    expect(ln.map((x) => [x.year, x.dayun])).toEqual([
      [2042, '甲子'],
      [2043, '甲子'],
      [2044, '癸亥'],
      [2045, '癸亥'],
      [2046, '癸亥'],
    ]);
    // 与大运表的起止年对照：癸亥 2043–2052，但 2043 流年按立春归甲子
    expect(C01_DAYUN.steps[1]).toMatchObject({ ganzhi: '癸亥', startYear: 2043, endYear: 2052 });
  });

  it('起运时刻早于当年立春：起运当年流年即属第一步大运', () => {
    // 构造：起运 2030-01-10，第二步自 2040-01-10 起
    const d: Dayun = { ...C01_DAYUN, qiyunTime: '2030-01-10 00:00', qiyunDate: '2030-01-10' };
    const ln = computeLiunian(bj('2029-06-01', '12:00'), d);
    expect(ln[0]?.dayun).toBeNull();
    expect(ln[1]).toMatchObject({ year: 2030, dayun: d.steps[0]?.ganzhi });
    expect(dayunAtBeijing(d, formatBeijing(lichunUtcMs(2040)))).toBe(d.steps[1]?.ganzhi);
  });

  it('换运时刻与立春同一分钟：属新的一步（左闭右开），前一分钟属上一步', () => {
    // 2030 立春 2030-02-04 03:08:28 → 构造起运于 2020-02-04 03:08，则第二步自 2030-02-04 03:08 起
    const d: Dayun = { ...C01_DAYUN, qiyunTime: '2020-02-04 03:08', qiyunDate: '2020-02-04' };
    expect(formatBeijing(lichunUtcMs(2030))).toBe('2030-02-04 03:08:28');
    expect(dayunAtBeijing(d, '2030-02-04 03:08:28')).toBe(d.steps[1]?.ganzhi);
    expect(dayunAtBeijing(d, '2030-02-04 03:07:59')).toBe(d.steps[0]?.ganzhi);
    expect(dayunAtBeijing(d, '2020-02-04 03:07:59')).toBeNull();
  });

  it('超出 8 步大运（起运后 80 年）：按顺逆继续推第 9 步，不为 null', () => {
    // C01 逆排，第 8 步丁巳 2103-12-01 起，第 9 步丙辰 2113-12-01 起
    const ln = computeLiunian(bj('2100-06-01', '12:00'), C01_DAYUN);
    expect(ln.map((x) => x.dayun)).toEqual(['戊午', '戊午', '戊午', '戊午', '丁巳']);
    expect(dayunAtBeijing(C01_DAYUN, '2113-12-01 08:09:59')).toBe('丁巳');
    expect(dayunAtBeijing(C01_DAYUN, '2113-12-01 08:10:00')).toBe('丙辰');
    expect(dayunAtBeijing(C01_DAYUN, '2123-12-01 08:10:00')).toBe('乙卯');
    expect(C01_DAYUN.steps).toHaveLength(8); // 对外大运表不变
  });

  it('1930 年出生、参考日期 2026 年（90 余岁）：流年大运落在第 9、10 步', () => {
    const utcMs = bj('1930-05-15', '10:00');
    const ym = computeYearMonth(utcMs);
    const d = computeDayun(utcMs, '男', ym).dayun;
    expect(d.steps).toHaveLength(8);
    const ln = computeLiunian(bj('2026-10-29', '12:00'), d);
    for (const x of ln) {
      expect(x.dayun).not.toBeNull();
      // 立春所在步序 i → 干支 = 月柱按顺逆推 i + 1 位
      const qy = Number(d.qiyunTime.slice(0, 4));
      let i = Math.floor((x.year - qy) / 10);
      if (x.lichun.slice(5, 16) < d.qiyunTime.slice(5, 16) && (x.year - qy) % 10 === 0) i -= 1;
      expect(i).toBeGreaterThanOrEqual(8);
      const step = d.direction === '顺' ? i + 1 : -(i + 1);
      expect(x.dayun, `${x.year}`).toBe(ganZhiAt(ganZhiIndex(ym.month) + step));
      expect(x.dayun).toBe(dayunStepGanzhi(d, i));
    }
  });

  it('dayunStepGanzhi：前 8 步与大运表一致，顺逆各自连续推进', () => {
    for (const g of ['男', '女'] as const) {
      const d = dayunOf('1990-08-08', '08:00', g);
      d.steps.forEach((s, i) => expect(dayunStepGanzhi(d, i)).toBe(s.ganzhi));
      const delta = d.direction === '顺' ? 1 : 59;
      for (let i = 8; i < 15; i++) {
        expect(ganZhiIndex(dayunStepGanzhi(d, i))).toBe(
          (ganZhiIndex(dayunStepGanzhi(d, i - 1)) + delta) % 60,
        );
      }
    }
    expect(() => dayunStepGanzhi(C01_DAYUN, -1)).toThrow();
  });

  it('2 月 29 日起运：平年换运时刻按 2 月 28 日之后、3 月 1 日之前处理', () => {
    const d: Dayun = { ...C01_DAYUN, qiyunTime: '2024-02-29 12:00', qiyunDate: '2024-02-29' };
    expect(dayunAtBeijing(d, '2034-02-28 23:59:59')).toBe(d.steps[0]?.ganzhi);
    expect(dayunAtBeijing(d, '2034-03-01 00:00:00')).toBe(d.steps[1]?.ganzhi);
  });

  it('cases.json 全部四柱案例：每个流年的大运 = 立春时刻所在步，且与大运起止年一致或为起运年 / 换运年的前一步', () => {
    for (const c of loadCases().cases) {
      if (c.input.time === null) continue;
      const { solarDate } = resolveSolarDate(c.input);
      const utcMs = clockToUtc(solarDate, engineClockOf(c).slice(11), c.raw.input.timezone).utcMs;
      const dayun = computeDayun(utcMs, c.input.gender, computeYearMonth(utcMs)).dayun;
      const qy = Number(dayun.qiyunDate.slice(0, 4));
      const ln = computeLiunian(
        fromBeijingParts({ year: qy, month: 1, day: 1, hour: 0, minute: 0, second: 0 }),
        dayun,
        80,
      );
      for (const x of ln) {
        const byYear = dayun.steps.findIndex((s) => s.startYear <= x.year && x.year <= s.endYear);
        const lichunMd = x.lichun.slice(5, 16);
        const qiyunMd = dayun.qiyunTime.slice(5, 16);
        // 立春早于当年换运时刻 → 换运年的流年仍属前一步
        const expectedIdx = (x.year - qy) % 10 === 0 && lichunMd < qiyunMd ? byYear - 1 : byYear;
        const expected = expectedIdx < 0 ? null : (dayun.steps[expectedIdx]?.ganzhi ?? null);
        expect(x.dayun, `${c.id} ${x.year}`).toBe(expected);
      }
    }
  });
});
