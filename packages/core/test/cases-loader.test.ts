import { describe, expect, it } from 'vitest';
import { DI_ZHI, TIAN_GAN, isGanZhi } from '../src/bazi/ganzhi';
import { loadCases, parseCasesFile } from './helpers/cases';
import { readRulesFile } from './helpers/fixtures';

/** 每次返回一份新的原始 JSON，供构造错误样例（不修改 rules/ 文件）。 */
function rawJson(): { cases: unknown[] } {
  return JSON.parse(readRulesFile('cases.json')) as { cases: unknown[] };
}

const DELETE = Symbol('delete');

/** 在原始 JSON 的拷贝上按路径改一个值（或删除），返回解析函数。 */
function mutated(path: (string | number)[], value: unknown) {
  const j: unknown = rawJson();
  let cur = j as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (value === DELETE) Reflect.deleteProperty(cur, last);
  else cur[last] = value;
  return () => parseCasesFile(j);
}

describe('isGanZhi', () => {
  it('10 干 × 12 支中恰有 60 个合法干支', () => {
    const all = TIAN_GAN.flatMap((g) => DI_ZHI.map((z) => `${g}${z}`));
    expect(all.filter(isGanZhi)).toHaveLength(60);
    expect(isGanZhi('甲子')).toBe(true);
    expect(isGanZhi('癸亥')).toBe(true);
    expect(isGanZhi('甲丑')).toBe(false);
    expect(isGanZhi('甲')).toBe(false);
    expect(isGanZhi('甲子丑')).toBe(false);
  });
});

describe('cases.json loader', () => {
  const { meta, cases } = loadCases();

  it('读取 v2 元数据与 test_guidance', () => {
    expect(meta.version).toBe('v2');
    expect(meta.test_guidance.length).toBeGreaterThanOrEqual(7);
  });

  it('全部案例解析成功（C01–C20，编号连续且唯一）', () => {
    const raw = rawJson();
    expect(cases).toHaveLength(raw.cases.length);
    expect(cases.length).toBeGreaterThanOrEqual(19);
    expect(cases.map((c) => c.id)).toEqual(
      Array.from({ length: cases.length }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('每个案例都映射为结构合法的 BirthInput', () => {
    for (const c of cases) {
      const inp = c.input;
      expect(['solar', 'lunar']).toContain(inp.calendar);
      expect(inp.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(inp.time === null || /^\d{2}:\d{2}$/.test(inp.time)).toBe(true);
      expect(['男', '女']).toContain(inp.gender);
      expect(inp.jieqiChoice).toBeNull();
      expect('isLeapMonth' in inp).toBe(inp.calendar === 'lunar');
      expect(inp.time === null).toBe(c.expected.pillars.hour === null);
    }
  });

  it('公历案例：日期、时间、性别原样映射', () => {
    const c01 = cases.find((c) => c.id === 'C01');
    expect(c01?.input).toEqual({
      calendar: 'solar',
      date: '2024-02-04',
      time: '16:10',
      gender: '男',
      placeCode: null,
      jieqiChoice: null,
    });
    expect(c01?.solarDateTime).toBe('2024-02-04 16:10');
  });

  it('农历闰月案例：date 为农历日期、isLeapMonth = true，并保留公历对照', () => {
    const c06 = cases.find((c) => c.id === 'C06');
    expect(c06?.input).toEqual({
      calendar: 'lunar',
      date: '2023-02-18',
      isLeapMonth: true,
      time: '10:00',
      gender: '女',
      placeCode: null,
      jieqiChoice: null,
    });
    expect(c06?.solarDateTime).toBe('2023-04-08 10:00');
    expect(cases.find((c) => c.id === 'C07')?.input).toMatchObject({
      calendar: 'lunar',
      date: '2023-02-15',
      isLeapMonth: true,
      time: '08:30',
    });
  });

  it('C03 公历输入附带的农历仅供对照，不改变 calendar', () => {
    expect(cases.find((c) => c.id === 'C03')?.input.calendar).toBe('solar');
  });

  it('出生地映射为测试地区代码，并保留原始经度', () => {
    const c08 = cases.find((c) => c.id === 'C08');
    expect(c08?.input.placeCode).toBe('650100');
    expect(c08?.birthplace).toEqual({ name: '新疆乌鲁木齐', longitude: 87.62 });
    expect(cases.find((c) => c.id === 'C09')?.input.placeCode).toBe('230100');
    expect(cases.filter((c) => c.input.placeCode !== null).map((c) => c.id)).toEqual([
      'C08',
      'C09',
    ]);
  });

  it('不知道时辰的案例 time = null、时柱期望为 null', () => {
    const noHour = cases.filter((c) => c.input.time === null);
    expect(noHour.map((c) => c.id)).toEqual(['C18', 'C19']);
    for (const c of noHour) {
      expect(c.solarDateTime).toBeNull();
      expect(c.expected.pillars.hour).toBeNull();
    }
  });
});

describe('cases.json loader：格式错误时明确报错', () => {
  it('版本不是 v2', () => {
    expect(mutated(['_meta', 'version'], 'v1')).toThrow('_meta.version');
  });

  it('案例编号重复', () => {
    expect(mutated(['cases', 1, 'id'], 'C01')).toThrow('案例编号重复');
  });

  it('干支不合法', () => {
    expect(mutated(['cases', 0, 'expected', 'pillars', 'day'], '甲丑')).toThrow(
      'C01.expected.pillars.day',
    );
  });

  it('有时辰却缺时柱', () => {
    expect(mutated(['cases', 0, 'expected', 'pillars', 'hour'], null)).toThrow(
      'C01.expected.pillars.hour',
    );
  });

  it('solar_datetime 与 solar_date 不一致', () => {
    expect(mutated(['cases', 0, 'input', 'solar_datetime'], '2024-02-05 16:10')).toThrow(
      'C01.input.solar_datetime',
    );
  });

  it('非法公历日期', () => {
    expect(mutated(['cases', 0, 'input', 'solar_date'], '2024-02-30')).toThrow(
      'C01.input.solar_date',
    );
  });

  it('农历时间与公历时间不一致', () => {
    expect(mutated(['cases', 5, 'input', 'lunar', 'time'], '11:00')).toThrow(
      'C06.input.lunar.time',
    );
  });

  it('出生地不在测试地区表', () => {
    expect(mutated(['cases', 7, 'input', 'birthplace', 'name'], '某地')).toThrow('测试地区表缺少');
  });

  it('出生地经度与测试地区表不一致', () => {
    expect(mutated(['cases', 7, 'input', 'birthplace', 'longitude'], 87.0)).toThrow('经度');
  });

  it('非 Asia/Shanghai 时区暂不支持', () => {
    expect(mutated(['cases', 0, 'input', 'timezone'], 'America/New_York')).toThrow('Asia/Shanghai');
  });

  it('缺少 shensha_ji', () => {
    expect(mutated(['cases', 0, 'expected', 'shensha_ji'], DELETE)).toThrow(
      'C01.expected.shensha_ji',
    );
  });

  it('power 不是 5 个数值', () => {
    expect(mutated(['cases', 0, 'expected', 'strength', 'power', '木'], DELETE)).toThrow(
      'C01.expected.strength.power',
    );
  });

  it('大运不是 3 步', () => {
    expect(mutated(['cases', 0, 'expected', 'dayun', 'first3', 'length'], 2)).toThrow(
      'C01.expected.dayun.first3',
    );
  });
});
