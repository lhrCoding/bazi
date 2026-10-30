/**
 * T13：Chart 输出定稿与公开 API computeChart(input, refDate)。
 * - 全部 cases.json 案例：输出通过 ChartSchema、JSON 往返不变、同输入两次深度相等、不改动输入、不读系统时钟；
 * - 字段语义：input_echo、solar_date、藏干 / 十神、三柱模式、真太阳时状态、近时辰边界、rules_hit、流年与 refDate；
 * - 错误：输入结构不合法、出生地未知、refDate 不合法 → 只抛错误码，错误信息不含输入值；
 * - ChartSchema 本身能拦住多余字段与字段间不一致。
 * cases.json 字段对照见 cases.test.ts（同样经 computeChart）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BirthInputSchema,
  CAL_RULE_IDS,
  ChartSchema,
  computeChart,
  ENGINE_VERSION,
  type BirthInput,
  type Chart,
} from '../src/index';
import { BaziError, type BaziErrorCode } from '../src/bazi/errors';
import { TIAN_GAN, type Gan, type Zhi } from '../src/bazi/ganzhi';
import { HIDDEN_STEMS, tenGodOf } from '../src/bazi/ten-gods';
import { loadCases, type LoadedCase } from './helpers/cases';

const { cases } = loadCases();
const byId = (id: string): LoadedCase => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`缺少案例 ${id}`);
  return c;
};

/** 2026-10-30 00:00 北京时间（毫秒） */
const REF = Date.parse('2026-10-30T00:00:00+08:00');

const solar = (date: string, time: string | null, extra: Partial<BirthInput> = {}): BirthInput => ({
  calendar: 'solar',
  date,
  time,
  gender: '男',
  placeCode: null,
  jieqiChoice: null,
  ...extra,
});

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function expectCode(fn: () => unknown, code: BaziErrorCode, ...forbidden: string[]): void {
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
}

describe('全部 cases.json 案例：schema、确定性、纯函数', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const c of cases) {
    it(`${c.id} ${c.title}`, () => {
      const a = computeChart(c.input, REF);
      const b = computeChart(c.input, REF);
      expect(ChartSchema.safeParse(a).success).toBe(true);
      expect(b).toStrictEqual(a);
      expect(b).not.toBe(a);
      // JSON 可序列化：往返后不变（无 Date、undefined、NaN 等）
      expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
      expect(a.engineVersion).toBe(ENGINE_VERSION);
      expect(a.refDate).toBe(REF);
      expect(a.input_echo).toStrictEqual(c.input);
      expect(a.solar_date).toBe(c.solarDate);
      expect(a.hourKnown).toBe(c.input.time !== null);

      // 冻结的输入不被改动；不读系统时钟（把系统时间拨到别的年份，结果不变）
      const frozen = deepFreeze(structuredClone(c.input));
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2077-07-07T07:07:07Z'));
      expect(computeChart(frozen, REF)).toStrictEqual(a);
    });
  }
});

describe('藏干与十神', () => {
  // S-HIDE 表与 rules/strength.md §1.2 JSON 参数块的逐项比对见 rules-params.test.ts（T14 参数漂移测试统一维护）。

  it('十神 10 × 10 全表（生克 + 阴阳：同阴阳为偏）', () => {
    // 行：日干 甲…癸；列：目标天干 甲…癸
    const table: Record<Gan, string> = {
      甲: '比肩 劫财 食神 伤官 偏财 正财 七杀 正官 偏印 正印',
      乙: '劫财 比肩 伤官 食神 正财 偏财 正官 七杀 正印 偏印',
      丙: '偏印 正印 比肩 劫财 食神 伤官 偏财 正财 七杀 正官',
      丁: '正印 偏印 劫财 比肩 伤官 食神 正财 偏财 正官 七杀',
      戊: '七杀 正官 偏印 正印 比肩 劫财 食神 伤官 偏财 正财',
      己: '正官 七杀 正印 偏印 劫财 比肩 伤官 食神 正财 偏财',
      庚: '偏财 正财 七杀 正官 偏印 正印 比肩 劫财 食神 伤官',
      辛: '正财 偏财 正官 七杀 正印 偏印 劫财 比肩 伤官 食神',
      壬: '食神 伤官 偏财 正财 七杀 正官 偏印 正印 比肩 劫财',
      癸: '伤官 食神 正财 偏财 正官 七杀 正印 偏印 劫财 比肩',
    };
    for (const day of TIAN_GAN) {
      expect(TIAN_GAN.map((t) => tenGodOf(day, t)).join(' '), day).toBe(table[day]);
    }
  });

  it('Chart 中的藏干、十神与四柱一致（日柱天干为「日主」，三柱模式时柱为 null）', () => {
    for (const c of cases) {
      const ch = computeChart(c.input, REF);
      const dayGan = ch.pillars.day.charAt(0) as Gan;
      expect(ch.ten_gods.day).toBe('日主');
      for (const pos of ['year', 'month', 'day', 'hour'] as const) {
        const gz = ch.pillars[pos];
        if (gz === null) {
          expect(ch.hidden_stems[pos]).toBeNull();
          expect(ch.ten_gods[pos]).toBeNull();
          continue;
        }
        const expected = HIDDEN_STEMS[gz.charAt(1) as Zhi].map(([gan, ratio]) => ({
          gan,
          ratio,
          ten_god: tenGodOf(dayGan, gan),
        }));
        expect(ch.hidden_stems[pos], `${c.id} ${pos}`).toEqual(expected);
        if (pos !== 'day') expect(ch.ten_gods[pos]).toBe(tenGodOf(dayGan, gz.charAt(0) as Gan));
      }
    }
  });

  it('C05 乙巳日 戊子时：时干正财、时支藏癸偏印；年干乙比肩、月干己偏财', () => {
    const ch = computeChart(byId('C05').input, REF);
    expect(ch.pillars).toEqual({ year: '乙亥', month: '己卯', day: '乙巳', hour: '戊子' });
    expect(ch.ten_gods).toEqual({ year: '比肩', month: '偏财', day: '日主', hour: '正财' });
    expect(ch.hidden_stems.hour).toEqual([{ gan: '癸', ratio: 1, ten_god: '偏印' }]);
    expect(ch.hidden_stems.day).toEqual([
      { gan: '丙', ratio: 0.6, ten_god: '伤官' },
      { gan: '庚', ratio: 0.3, ten_god: '正官' },
      { gan: '戊', ratio: 0.1, ten_god: '正财' },
    ]);
  });
});

describe('三柱模式（CAL-NOHOUR）字段', () => {
  it('C18：无交节日 —— 时柱相关全为 null，未校正，近边界恒 false，约 X 岁起运', () => {
    const ch = computeChart(byId('C18').input, REF);
    expect(ch.hourKnown).toBe(false);
    expect(ch.pillars.hour).toBeNull();
    expect(ch.tst_status).toBe('未校正');
    expect(ch.true_solar_time).toBeNull();
    expect(ch.near_shichen_boundary).toBe(false);
    expect(ch.jieqi_on_birthday).toBeNull();
    expect(ch.jieqi_side).toBeNull();
    expect(ch.uncertain).toEqual({ month_pillar: null, jieqi_time: null });
    expect(ch.dayun.approximate).toBe(true);
    // 1990-05-20 处于夏令时：默认 12:00 是钟表时间，即北京标准时间 11:00
    expect(ch.clock_to_utc).toEqual({
      utc: '1990-05-20T03:00:00Z',
      timezone: 'Asia/Shanghai',
      utcOffsetMinutes: 540,
      dstAmbiguous: false,
    });
    expect(ch.rules_hit).toEqual([
      'CAL-TZ',
      'CAL-YM-1',
      'CAL-YM-2',
      'CAL-DH',
      'CAL-YUN',
      'CAL-NOHOUR',
    ]);
  });

  it('C19：当天立春交节、未选前后 —— uncertain 两组年月柱、jieqi_on_birthday、按 12:00 所在一侧', () => {
    const c = byId('C19');
    const ch = computeChart(c.input, REF);
    expect(ch.jieqi_on_birthday?.name).toBe('立春');
    expect(ch.uncertain.jieqi_time).toBe(ch.jieqi_on_birthday?.time);
    expect(ch.uncertain.month_pillar).not.toBeNull();
    // 2024 立春 16:27，12:00 在交节前
    expect(ch.jieqi_side).toBe('before');
    expect(ch.jieqi_next.name).toBe('立春');
  });

  it('C19 选 before / after：取所选一侧年月柱，uncertain 为 null；clock_to_utc 为实际计算时刻', () => {
    const c = byId('C19');
    const before = computeChart({ ...c.input, jieqiChoice: 'before' }, REF);
    const after = computeChart({ ...c.input, jieqiChoice: 'after' }, REF);
    expect(before.uncertain.month_pillar).toBeNull();
    expect(after.uncertain.month_pillar).toBeNull();
    expect(before.jieqi_side).toBe('before');
    expect(after.jieqi_side).toBe('after');
    expect([before.pillars.year, before.pillars.month]).toEqual(['癸卯', '乙丑']);
    expect([after.pillars.year, after.pillars.month]).toEqual(['甲辰', '丙寅']);
    expect(before.clock_to_utc.utc).toBe('2024-02-04T04:00:00Z');
    // 交节后半段中点（16:27:xx 至 24:00 的中点）不是整点钟表读数
    expect(after.clock_to_utc.utc > '2024-02-04T12:00:00Z').toBe(true);
  });
});

describe('真太阳时状态与 rules_hit', () => {
  it('未选出生地：未校正，true_solar_time 为 null，CAL-TST 仍记录', () => {
    const ch = computeChart(solar('2000-06-01', '10:00'), REF);
    expect(ch.tst_status).toBe('未校正');
    expect(ch.true_solar_time).toBeNull();
    expect(ch.rules_hit).toContain('CAL-TST');
    expect(ch.near_shichen_boundary).toBe(false); // 10:00 离 09:00 / 11:00 各 60 分钟
  });

  it('未选出生地且离时辰边界不足 30 分钟：near_shichen_boundary = true（只提示，不改排盘）', () => {
    expect(computeChart(solar('2000-06-01', '10:31'), REF).near_shichen_boundary).toBe(true);
    expect(computeChart(solar('2000-06-01', '10:30'), REF).near_shichen_boundary).toBe(false);
    expect(computeChart(solar('2000-06-01', '22:59'), REF).near_shichen_boundary).toBe(true);
  });

  it('选了出生地：已校正，带北京时间 → 真太阳时说明，near_shichen_boundary 恒 false，CAL-TST 记录', () => {
    const ch = computeChart(byId('C08').input, REF);
    expect(ch.tst_status).toBe('已校正');
    expect(ch.true_solar_time?.beijingTime).toBe('2001-03-10 00:40');
    expect(ch.true_solar_time?.trueSolarTime.slice(0, 13)).toBe('2001-03-09 22');
    expect(ch.near_shichen_boundary).toBe(false);
    expect(ch.rules_hit).toEqual([
      'CAL-TZ',
      'CAL-YM-1',
      'CAL-YM-2',
      'CAL-TST',
      'CAL-DH',
      'CAL-YUN',
    ]);
  });

  it('农历输入记 CAL-INPUT；子时记 CAL-DH-ZI；晚子时 alt 日柱为次日', () => {
    expect(computeChart(byId('C06').input, REF).rules_hit[0]).toBe('CAL-INPUT');
    const c05 = computeChart(byId('C05').input, REF);
    expect(c05.rules_hit).toContain('CAL-DH-ZI');
    expect(c05.alt.zi_huanri_day_pillar).toBe('丙午');
    expect(computeChart(byId('C04').input, REF).rules_hit).toContain('CAL-DH-ZI');
  });

  it('rules_hit 去重、只含登记编号、按判定流程排序', () => {
    for (const c of cases) {
      const hits = computeChart(c.input, REF).rules_hit;
      const idx = hits.map((h) => CAL_RULE_IDS.indexOf(h));
      expect(
        idx.every((v, i) => v >= 0 && (i === 0 || v > (idx[i - 1] as number))),
        c.id,
      ).toBe(true);
      expect(hits).toContain('CAL-TZ');
      expect(hits).toContain('CAL-YUN');
      expect(hits.includes('CAL-TST')).toBe(c.input.time !== null);
      expect(hits.includes('CAL-NOHOUR')).toBe(c.input.time === null);
    }
  });

  it('夏令时结束日重复时刻：clock_to_utc.dstAmbiguous = true', () => {
    const ch = computeChart(solar('1990-09-16', '01:30'), REF);
    expect(ch.clock_to_utc.dstAmbiguous).toBe(true);
    expect(ch.clock_to_utc.utcOffsetMinutes).toBe(480);
  });
});

describe('refDate（Unix 毫秒）与流年', () => {
  const input = byId('C01').input;

  it('只影响 refDate 与流年，其余字段完全相同', () => {
    const a = computeChart(input, REF);
    const b = computeChart(input, Date.parse('2031-01-15T00:00:00+08:00'));
    const { refDate: ra, liunian: la, ...restA } = a;
    const { refDate: rb, liunian: lb, ...restB } = b;
    expect(restB).toStrictEqual(restA);
    expect(ra).not.toBe(rb);
    expect(la.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    // 2031-01-15 在 2031 立春之前，仍属 2030 庚戌年
    expect(lb.map((y) => y.year)).toEqual([2030, 2031, 2032, 2033, 2034]);
  });

  it('立春交节时刻前后 1 毫秒：流年起始年切换', () => {
    const lichun2027 = Date.parse('2027-02-04T09:46:18+08:00');
    expect(computeChart(input, lichun2027 - 1000).liunian[0]?.year).toBe(2026);
    expect(computeChart(input, lichun2027).liunian[0]?.year).toBe(2027);
  });

  it('refDate 不合法 → E_INVALID_REF_DATE', () => {
    for (const bad of [
      Number.NaN,
      1.5,
      Number.POSITIVE_INFINITY,
      Date.parse('1899-12-31T00:00:00Z'),
      Date.parse('2101-01-02T00:00:00Z'),
      new Date(REF) as unknown as number,
      String(REF) as unknown as number,
    ]) {
      expectCode(() => computeChart(input, bad), 'E_INVALID_REF_DATE');
    }
  });
});

describe('输入校验与错误码（错误信息不含输入值）', () => {
  it('结构不合法 → E_INVALID_INPUT', () => {
    const base = solar('1987-06-05', '13:57');
    const bads: unknown[] = [
      null,
      'x',
      { ...base, gender: '未知' },
      { ...base, time: '1357' },
      { ...base, date: '1987/06/05' },
      { ...base, secret: '1987-06-05' }, // 多余字段
      { ...base, gender: undefined }, // 缺字段
      { ...base, placeCode: 650100 },
      { ...base, jieqiChoice: 'maybe' },
    ];
    for (const b of bads)
      expectCode(() => computeChart(b, REF), 'E_INVALID_INPUT', '1987', '13:57');
  });

  it('出生地代码不存在 → E_UNKNOWN_PLACE', () => {
    expectCode(
      () => computeChart(solar('1987-06-05', '13:57', { placeCode: '999999' }), REF),
      'E_UNKNOWN_PLACE',
      '999999',
    );
  });

  it('下层错误码原样透出：非法日期、夏令时不存在的时刻、农历无此闰月、超出范围', () => {
    expectCode(() => computeChart(solar('2023-02-30', '10:00'), REF), 'E_INVALID_DATETIME', '2023');
    expectCode(() => computeChart(solar('1990-04-15', '02:30'), REF), 'E_DST_GAP', '02:30');
    expectCode(
      () =>
        computeChart(
          { ...solar('2023-03-10', '10:00'), calendar: 'lunar', isLeapMonth: true },
          REF,
        ),
      'E_LUNAR_NO_LEAP',
    );
    expectCode(() => computeChart(solar('1899-12-31', '10:00'), REF), 'E_DATE_OUT_OF_RANGE');
  });

  it('BirthInputSchema 接受全部案例输入', () => {
    for (const c of cases) expect(BirthInputSchema.safeParse(c.input).success, c.id).toBe(true);
  });
});

describe('ChartSchema 自身', () => {
  const good = (): Chart => structuredClone(computeChart(byId('C01').input, REF));

  it('拒绝多余字段（防止未声明的数据混入输出）', () => {
    expect(ChartSchema.safeParse({ ...good(), birth: 'x' }).success).toBe(false);
    const g = good();
    expect(ChartSchema.safeParse({ ...g, pillars: { ...g.pillars, extra: 1 } }).success).toBe(
      false,
    );
  });

  it('拒绝字段间不一致', () => {
    const mutations: ((c: Chart) => void)[] = [
      (c) => (c.hourKnown = false),
      (c) => (c.pillars.hour = null),
      (c) => (c.tst_status = '已校正'),
      (c) => (c.dayun.approximate = true),
      (c) => (c.rules_hit = [...c.rules_hit].reverse()),
      (c) => (c.uncertain.jieqi_time = '2024-02-04 16:26:53'),
      (c) => (c.jieqi_side = 'after'),
      (c) => (c.pillars.day = '甲丑' as Chart['pillars']['day']),
      (c) => c.liunian.pop(),
    ];
    for (const [i, m] of mutations.entries()) {
      const c = good();
      m(c);
      expect(ChartSchema.safeParse(c).success, `变异 #${i}`).toBe(false);
    }
    // 已校正时 near_shichen_boundary 必须为 false
    const c08 = structuredClone(computeChart(byId('C08').input, REF));
    expect(ChartSchema.safeParse(c08).success).toBe(true);
    c08.near_shichen_boundary = true;
    expect(ChartSchema.safeParse(c08).success).toBe(false);
  });
});
