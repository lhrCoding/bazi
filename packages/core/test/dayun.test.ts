/**
 * T09：CAL-YUN 起运与大运（rules/calendar.md §8）。
 * - 顺逆：阳男阴女顺、阴男阳女逆（年干以立春为界）。
 * - 起运按分钟折算（Sect2）：3 天 = 1 年、6 小时 = 1 个月、12 分钟 = 1 天、1 分钟 = 2 小时。
 * - 手工用例：顺、逆各 2 个，偏移量与起运日期均为手算值（计算过程写在用例注释里）。
 * - cases.json：方向、前三步干支与起始年完全一致，qiyun_date ±1 天（cases.test.ts 统一比对；这里补充虚岁）。
 * - 与 tyme4ts（LunarSect2ChildLimitProvider）交叉校验：全部案例 + 随机时刻，偏移、起运时刻、8 步大运逐项一致。
 */
import { describe, expect, it } from 'vitest';
import { tymeChildLimitAt } from '../src/bazi/calendar-adapter';
import { clockToUtc } from '../src/bazi/clock';
import {
  addQiyunOffset,
  computeDayun,
  dayunDirection,
  qiyunOffsetOf,
  zhousuiAt,
  DAYUN_STEP_COUNT,
} from '../src/bazi/dayun';
import { ganZhiAt, ganZhiIndex, TIAN_GAN, type GanZhi } from '../src/bazi/ganzhi';
import { resolveSolarDate } from '../src/bazi/lunar-input';
import { fromBeijingParts, toBeijingParts, type DateTimeParts } from '../src/bazi/time';
import type { Gender } from '../src/bazi/types';
import { computeYearMonth } from '../src/bazi/year-month';
import { engineClockOf, loadCases } from './helpers/cases';

const at = (s: string): DateTimeParts => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`bad datetime ${s}`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
  };
};

/** 北京钟表时间（无夏令时的年份）→ 大运 */
function dayunAt(datetime: string, gender: Gender) {
  const [d, t] = datetime.split(' ') as [string, string];
  const { utcMs } = clockToUtc(d, t, 'Asia/Shanghai');
  const ym = computeYearMonth(utcMs);
  return { ym, ...computeDayun(utcMs, gender, ym) };
}

describe('ganZhiIndex', () => {
  it('与 ganZhiAt 互逆（60 甲子全表）', () => {
    for (let i = 0; i < 60; i++) expect(ganZhiIndex(ganZhiAt(i))).toBe(i);
  });
  it('非法干支报错', () => {
    expect(() => ganZhiIndex('甲丑')).toThrow();
    expect(() => ganZhiIndex('甲')).toThrow();
  });
});

describe('顺逆：阳男阴女顺、阴男阳女逆', () => {
  it('十天干 × 两性别全表', () => {
    TIAN_GAN.forEach((g, i) => {
      const year = ganZhiAt(i) as GanZhi; // 天干为 g 的某个干支
      expect(year.startsWith(g)).toBe(true);
      const yang = i % 2 === 0;
      expect(dayunDirection(year, '男')).toBe(yang ? '顺' : '逆');
      expect(dayunDirection(year, '女')).toBe(yang ? '逆' : '顺');
    });
  });

  it('年干以立春为界：2024 立春（16:27）前后，同为男命方向相反', () => {
    // 立春前仍为癸卯（阴）年 → 男逆；立春后甲辰（阳）年 → 男顺
    expect(dayunAt('2024-02-04 16:10', '男').dayun.direction).toBe('逆');
    expect(dayunAt('2024-02-04 16:45', '男').dayun.direction).toBe('顺');
  });
});

describe('起运折算（按分钟，3 天 = 1 年）', () => {
  const MIN = 60_000;
  it('整单位换算', () => {
    expect(qiyunOffsetOf(4320 * MIN)).toEqual({ years: 1, months: 0, days: 0, hours: 0 });
    expect(qiyunOffsetOf(360 * MIN)).toEqual({ years: 0, months: 1, days: 0, hours: 0 });
    expect(qiyunOffsetOf(12 * MIN)).toEqual({ years: 0, months: 0, days: 1, hours: 0 });
    expect(qiyunOffsetOf(1 * MIN)).toEqual({ years: 0, months: 0, days: 0, hours: 2 });
    // 1 天 = 4 个月；1 小时 = 5 天
    expect(qiyunOffsetOf(1440 * MIN)).toEqual({ years: 0, months: 4, days: 0, hours: 0 });
    expect(qiyunOffsetOf(60 * MIN)).toEqual({ years: 0, months: 0, days: 5, hours: 0 });
  });
  it('不足 1 分钟的秒数舍去；方向不影响（取绝对值）', () => {
    expect(qiyunOffsetOf(59_999)).toEqual({ years: 0, months: 0, days: 0, hours: 0 });
    expect(qiyunOffsetOf(-(4320 + 360 + 12 + 1) * MIN - 59_000)).toEqual({
      years: 1,
      months: 1,
      days: 1,
      hours: 2,
    });
  });
});

describe('起运日期加法', () => {
  it('小时进日、月进年', () => {
    expect(
      addQiyunOffset(at('2001-12-20 20:30'), { years: 1, months: 1, days: 3, hours: 6 }),
    ).toEqual(at('2003-01-24 02:30'));
  });
  it('日数超过当月天数顺延到下月（与 lunar / tyme4ts 相同）', () => {
    // 1 月 31 日 + 1 个月 → 2 月没有 31 日 → 顺延：平年 3 月 3 日、闰年 3 月 2 日
    expect(
      addQiyunOffset(at('2001-01-31 10:00'), { years: 0, months: 1, days: 0, hours: 0 }),
    ).toEqual(at('2001-03-03 10:00'));
    expect(
      addQiyunOffset(at('2000-01-31 10:00'), { years: 0, months: 1, days: 0, hours: 0 }),
    ).toEqual(at('2000-03-02 10:00'));
    // 跨年顺延：12 月 20 日 + 1 个月 15 天 → 1 月 35 日 → 2 月 4 日
    expect(
      addQiyunOffset(at('2001-12-20 10:00'), { years: 0, months: 1, days: 15, hours: 0 }),
    ).toEqual(at('2002-02-04 10:00'));
  });
  it('周岁：只比较月日（含闰日生日）', () => {
    expect(zhousuiAt(at('2000-03-01 12:00'), at('2001-07-15 00:00'))).toBe(1);
    expect(zhousuiAt(at('2000-03-01 12:00'), at('2001-02-28 00:00'))).toBe(0);
    expect(zhousuiAt(at('2000-02-29 12:00'), at('2001-02-28 00:00'))).toBe(0);
    expect(zhousuiAt(at('2000-02-29 12:00'), at('2001-03-01 00:00'))).toBe(1);
  });
});

describe('手工用例（顺 2 个、逆 2 个；节气时刻取自 tyme4ts 寿星历，北京标准时间）', () => {
  interface Hand {
    title: string;
    datetime: string;
    gender: Gender;
    direction: '顺' | '逆';
    jie: string;
    offset: { years: number; months: number; days: number; hours: number };
    qiyunTime: string;
    qiyunAge: number;
    first3: [GanZhi, number, number][]; // 干支、开始年、开始虚岁
  }
  const HAND: Hand[] = [
    {
      // 庚辰阳年男 → 顺；月柱戊寅；下一个节 惊蛰 2000-03-05 14:42:40。
      // 03-01 12:00 → 03-05 14:42:40 = 4 天 + 162 分 40 秒 → 5922 分
      // 5922 = 1×4320 + 4×360 + 13×12 + 6 → 1 年 4 月 13 天 12 时
      // 2000-03-01 12:00 + 1 年 4 月 → 2001-07-01；+13 天 12 时 → 2001-07-15 00:00
      title: '顺·阳男：2000-03-01 12:00 男',
      datetime: '2000-03-01 12:00',
      gender: '男',
      direction: '顺',
      jie: '惊蛰',
      offset: { years: 1, months: 4, days: 13, hours: 12 },
      qiyunTime: '2001-07-15 00:00',
      qiyunAge: 1,
      first3: [
        ['己卯', 2001, 2],
        ['庚辰', 2011, 12],
        ['辛巳', 2021, 22],
      ],
    },
    {
      // 辛巳阴年女 → 顺；月柱甲午（丙辛年庚寅起，午月甲午）；下一个节 小暑 2001-07-07 09:06:42。
      // 07-01 08:00 → 07-07 09:06:42 = 6 天 + 66 分 42 秒 → 8706 分
      // 8706 = 2×4320 + 0×360 + 5×12 + 6 → 2 年 0 月 5 天 12 时 → 2003-07-06 20:00
      title: '顺·阴女：2001-07-01 08:00 女',
      datetime: '2001-07-01 08:00',
      gender: '女',
      direction: '顺',
      jie: '小暑',
      offset: { years: 2, months: 0, days: 5, hours: 12 },
      qiyunTime: '2003-07-06 20:00',
      qiyunAge: 2,
      first3: [
        ['乙未', 2003, 3],
        ['丙申', 2013, 13],
        ['丁酉', 2023, 23],
      ],
    },
    {
      // 庚辰阳年女 → 逆；月柱己卯；上一个节 惊蛰 2000-03-05 14:42:40。
      // 03-05 14:42:40 → 03-20 18:30 = 15 天 + 227 分 20 秒 → 21827 分
      // 21827 = 5×4320 + 0×360 + 18×12 + 11 → 5 年 0 月 18 天 22 时
      // 2005-03-20 18:30 + 18 天 22 时 → 2005-04-08 16:30
      title: '逆·阳女：2000-03-20 18:30 女',
      datetime: '2000-03-20 18:30',
      gender: '女',
      direction: '逆',
      jie: '惊蛰',
      offset: { years: 5, months: 0, days: 18, hours: 22 },
      qiyunTime: '2005-04-08 16:30',
      qiyunAge: 5,
      first3: [
        ['戊寅', 2005, 6],
        ['丁丑', 2015, 16],
        ['丙子', 2025, 26],
      ],
    },
    {
      // 辛巳阴年男 → 逆；月柱丙申；上一个节 立秋 2001-08-07 18:52:21。晚子时出生（不影响起运）。
      // 08-07 18:52:21 → 08-31 23:50 = 24 天 + 297 分 39 秒 → 34857 分
      // 34857 = 8×4320 + 0×360 + 24×12 + 9 → 8 年 0 月 24 天 18 时
      // 2009-08-31 23:50 + 24 天 18 时 → 8 月 56 日 17:50 → 2009-09-25 17:50（8 月 31 天，顺延）
      title: '逆·阴男：2001-08-31 23:50 男（月末顺延）',
      datetime: '2001-08-31 23:50',
      gender: '男',
      direction: '逆',
      jie: '立秋',
      offset: { years: 8, months: 0, days: 24, hours: 18 },
      qiyunTime: '2009-09-25 17:50',
      qiyunAge: 8,
      first3: [
        ['乙未', 2009, 9],
        ['甲午', 2019, 19],
        ['癸巳', 2029, 29],
      ],
    },
  ];

  for (const h of HAND) {
    it(h.title, () => {
      const { dayun, qiyunJie, rules_hit } = dayunAt(h.datetime, h.gender);
      expect(dayun.direction).toBe(h.direction);
      expect(qiyunJie.name).toBe(h.jie);
      expect(dayun.qiyunOffset).toEqual(h.offset);
      expect(dayun.qiyunTime).toBe(h.qiyunTime);
      expect(dayun.qiyunDate).toBe(h.qiyunTime.slice(0, 10));
      expect(dayun.qiyunAge).toBe(h.qiyunAge);
      expect(dayun.approximate).toBe(false);
      expect(dayun.steps.slice(0, 3).map((s) => [s.ganzhi, s.startYear, s.startAgeXusui])).toEqual(
        h.first3,
      );
      expect(rules_hit).toEqual(['CAL-YUN']);
    });
  }
});

describe('8 步大运结构', () => {
  it('8 步、干支沿 60 甲子连续、每步 10 年、周岁与虚岁递增 10', () => {
    for (const [dt, g] of [
      ['2000-03-01 12:00', '男'],
      ['2000-03-20 18:30', '女'],
    ] as const) {
      const { ym, dayun } = dayunAt(dt, g);
      const step = dayun.direction === '顺' ? 1 : -1;
      expect(dayun.steps).toHaveLength(DAYUN_STEP_COUNT);
      const birthYear = Number(dt.slice(0, 4));
      dayun.steps.forEach((s, i) => {
        expect(s.ganzhi).toBe(ganZhiAt(ganZhiIndex(ym.month) + step * (i + 1)));
        expect(s.startYear).toBe(Number(dayun.qiyunDate.slice(0, 4)) + 10 * i);
        expect(s.endYear).toBe(s.startYear + 9);
        expect(s.startAge).toBe(dayun.qiyunAge + 10 * i);
        expect(s.startAgeXusui).toBe(s.startYear - birthYear + 1);
      });
    }
  });

  it('出生恰在交节时刻、逆排：起运间隔为 0，起运日 = 出生日', () => {
    const ym0 = computeYearMonth(fromBeijingParts(at('2000-03-05 15:00')));
    const t = ym0.jieqiPrevUtcMs; // 惊蛰 2000-03-05 14:42:40
    const ym = computeYearMonth(t);
    expect(ym.jieqiPrevUtcMs).toBe(t);
    const { dayun } = computeDayun(t, '女', ym); // 庚辰阳女逆
    expect(dayun.direction).toBe('逆');
    expect(dayun.qiyunOffset).toEqual({ years: 0, months: 0, days: 0, hours: 0 });
    expect(dayun.qiyunDate).toBe('2000-03-05');
    expect(dayun.qiyunAge).toBe(0);
  });

  it('approximate 选项透传（三柱模式由 T11 使用）', () => {
    const utcMs = fromBeijingParts(at('2000-03-01 12:00'));
    const ym = computeYearMonth(utcMs);
    expect(computeDayun(utcMs, '男', ym, { approximate: true }).dayun.approximate).toBe(true);
  });

  it('同输入两次输出深度相等', () => {
    expect(dayunAt('1981-12-22 20:00', '男')).toEqual(dayunAt('1981-12-22 20:00', '男'));
  });
});

// ---------- cases.json ----------

const { cases } = loadCases();

function caseDayun(c: (typeof cases)[number]) {
  const { solarDate } = resolveSolarDate(c.input);
  const { utcMs } = clockToUtc(solarDate, engineClockOf(c).slice(11), c.raw.input.timezone);
  const ym = computeYearMonth(utcMs);
  return { utcMs, ...computeDayun(utcMs, c.input.gender, ym) };
}

interface ExpDayun {
  direction: string;
  qiyun_date: string | null;
  first3: { ganzhi: string; start_year: number | null; start_age_xusui: number | null }[];
}

describe('cases.json 补充：前三步开始虚岁（cases.test.ts 已比对方向 / 干支 / 起始年 / 起运日期）', () => {
  for (const c of cases) {
    const e = c.expected.dayun as ExpDayun | undefined;
    if (!e) continue;
    const xusui = e.first3.map((s) => s.start_age_xusui);
    if (xusui.some((v) => v === null)) {
      it.todo(`[期望值待复核] ${c.id} dayun.first3.start_age_xusui`);
      continue;
    }
    it(`${c.id} ${c.title}`, () => {
      const { dayun } = caseDayun(c);
      expect(dayun.steps.slice(0, 3).map((s) => s.startAgeXusui)).toEqual(xusui);
    });
  }
});

describe('C20 代码计算值（cases.json 期望为 null，待 mingli-expert 确认；此处锁定防回归）', () => {
  it('1981-12-22 20:00 男：辛酉阴男逆排，数到上一个节大雪 1981-12-07 12:51:15', () => {
    const c = cases.find((x) => x.id === 'C20');
    if (!c) throw new Error('缺少 C20');
    const { dayun, qiyunJie } = caseDayun(c);
    expect(qiyunJie).toEqual({ name: '大雪', time: '1981-12-07 12:51:15' });
    expect(dayun.direction).toBe('逆');
    expect(dayun.qiyunOffset).toEqual({ years: 5, months: 1, days: 5, hours: 16 });
    expect(dayun.qiyunTime).toBe('1987-01-28 12:00');
    expect(dayun.qiyunAge).toBe(5);
    expect(
      dayun.steps.slice(0, 3).map((s) => [s.ganzhi, s.startYear, s.startAge, s.startAgeXusui]),
    ).toEqual([
      ['己亥', 1987, 5, 7],
      ['戊戌', 1997, 15, 17],
      ['丁酉', 2007, 25, 27],
    ]);
  });
});

// ---------- 与 tyme4ts 交叉校验 ----------

function compareWithTyme(utcMs: number, gender: Gender): string | null {
  const ym = computeYearMonth(utcMs);
  const { dayun } = computeDayun(utcMs, gender, ym);
  const p = toBeijingParts(utcMs);
  const t = tymeChildLimitAt(p, gender, DAYUN_STEP_COUNT);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const tymeTime = `${pad(t.end.year, 4)}-${pad(t.end.month)}-${pad(t.end.day)} ${pad(t.end.hour)}:${pad(t.end.minute)}`;
  const ours = {
    forward: dayun.direction === '顺',
    offset: dayun.qiyunOffset,
    time: dayun.qiyunTime,
    decades: dayun.steps.map((s) => [s.ganzhi, s.startYear, s.startAgeXusui]),
  };
  const theirs = {
    forward: t.forward,
    offset: { years: t.years, months: t.months, days: t.days, hours: t.hours },
    time: tymeTime,
    decades: t.decades.map((d) => [d.ganzhi, d.startYear, d.startAgeXusui]),
  };
  return JSON.stringify(ours) === JSON.stringify(theirs)
    ? null
    : `${JSON.stringify(p)} ${gender} ours ${JSON.stringify(ours)} tyme ${JSON.stringify(theirs)}`;
}

describe('与 tyme4ts（LunarSect2ChildLimitProvider）交叉校验', () => {
  it('cases.json 全部案例（含三柱案例按 12:00）：方向、偏移、起运时刻、8 步大运一致', () => {
    const bad = cases.flatMap((c) => {
      const e = compareWithTyme(caseDayun(c).utcMs, c.input.gender);
      return e ? [`${c.id} ${e}`] : [];
    });
    expect(bad).toEqual([]);
  });

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

  it('随机 1,000 个整分钟时刻（1901–2099）× 随机性别：全部一致', () => {
    const MIN = fromBeijingParts(at('1901-01-01 00:00'));
    const MAX = fromBeijingParts(at('2099-12-31 00:00'));
    const r = rng(20261030);
    const bad: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const ms = MIN + Math.floor((r() * (MAX - MIN)) / 60_000) * 60_000;
      const e = compareWithTyme(ms, r() < 0.5 ? '男' : '女');
      if (e) bad.push(e);
    }
    expect(bad).toEqual([]);
  });

  it('交节前后 ±1、±30 分钟（立春 / 惊蛰 / 大雪，若干年份）：全部一致', () => {
    const bad: string[] = [];
    for (const y of [1950, 1984, 2000, 2024, 2050]) {
      for (const dt of [`${y}-02-04 12:00`, `${y}-03-06 12:00`, `${y}-12-07 12:00`]) {
        const ym = computeYearMonth(fromBeijingParts(at(dt)));
        for (const jie of [ym.jieqiPrevUtcMs, ym.jieqiNextUtcMs]) {
          const base = Math.floor(jie / 60_000) * 60_000;
          for (const d of [-30, -1, 1, 30]) {
            for (const g of ['男', '女'] as const) {
              const e = compareWithTyme(base + d * 60_000, g);
              if (e) bad.push(e);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
