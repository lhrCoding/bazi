import { describe, expect, it } from 'vitest';
import {
  FIELD_CHECKS,
  NOT_COMPARED,
  PENDING_FIELDS,
  checkCaseField,
  compareField,
  ruleIdOf,
  uncoveredFields,
  type FieldCheck,
} from './helpers/case-compare';
import { loadCases } from './helpers/cases';

const { cases } = loadCases();
const byId = (id: string) => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`缺少案例 ${id}`);
  return c;
};
const check = (key: string): FieldCheck => {
  const c = FIELD_CHECKS.find((x) => x.key === key);
  if (!c) throw new Error(`缺少字段检查 ${key}`);
  return c;
};

describe('compareField：容差（test_guidance）', () => {
  it('strength.S ±0.001（含边界）', () => {
    const k = check('strength.S').kind;
    expect(compareField(k, 0.324, 0.324)).toBeNull();
    expect(compareField(k, 0.324, 0.325)).toBeNull();
    expect(compareField(k, 0.324, 0.323)).toBeNull();
    expect(compareField(k, 0.324, 0.3252)).toMatch('差');
    expect(compareField(k, 0.324, undefined)).not.toBeNull();
    expect(compareField(k, 0.324, Number.NaN)).not.toBeNull();
  });

  it('power / gods 每项 ±0.01，且五行键必须一致', () => {
    const k = check('strength.power').kind;
    const e = { 木: 1.8, 火: 0.15, 土: 2.8, 金: 2.35, 水: 2.0 };
    expect(compareField(k, e, { ...e, 火: 0.16 })).toBeNull();
    expect(compareField(k, e, { ...e, 火: 0.17 })).toMatch('火');
    const missing: Record<string, number> = { ...e };
    delete missing['水'];
    expect(compareField(k, e, missing)).toMatch('键不一致');
  });

  it('qiyun_date ±1 天（跨月、跨年也按日差计算）', () => {
    const k = check('dayun.qiyun_date').kind;
    expect(compareField(k, '2033-12-01', '2033-12-01')).toBeNull();
    expect(compareField(k, '2033-12-01', '2033-12-02')).toBeNull();
    expect(compareField(k, '2033-12-01', '2033-11-30')).toBeNull();
    expect(compareField(k, '2033-12-31', '2034-01-01')).toBeNull();
    expect(compareField(k, '2033-12-01', '2033-12-03')).toMatch('差 2 天');
    expect(compareField(k, '2033-12-01', 'bad')).not.toBeNull();
  });
});

describe('compareField：rules_hit 前缀比对', () => {
  const k = check('rules_hit').kind;

  it('按冒号前编号比对，冒号后文字不比，允许实际多出通用编号', () => {
    expect(
      compareField(
        k,
        ['S-COMBO:三合亥卯未木+1.5', 'Y-FY-W-CAI'],
        ['S-POWER', 'S-COMBO:三合亥卯未木+2', 'S-LEVEL:身弱', 'Y-FY-W-CAI'],
      ),
    ).toBeNull();
  });

  it('缺少任一编号即失败；编号须完全相同，不做前缀模糊匹配', () => {
    expect(compareField(k, ['Y-FY-W-SHA', 'Y-TH-AGREE'], ['Y-FY-W-SHA'])).toMatch('Y-TH-AGREE');
    expect(compareField(k, ['Y-FY-W-SHA'], ['Y-FY-W'])).toMatch('Y-FY-W-SHA');
    expect(compareField(k, ['Y-FY-W'], ['Y-FY-W-SHA'])).toMatch('Y-FY-W');
  });

  it('ruleIdOf 兼容半角、全角冒号', () => {
    expect(ruleIdOf('S-CONG:从财')).toBe('S-CONG');
    expect(ruleIdOf('S-CONG：从财')).toBe('S-CONG');
    expect(ruleIdOf('Y-TH-AGREE')).toBe('Y-TH-AGREE');
  });
});

describe('compareField：完全一致', () => {
  it('shensha_ji 名称、hits、by、顺序都必须一致', () => {
    const k = check('shensha_ji').kind;
    const e = byId('C01').expected.shensha_ji as {
      name: string;
      hits: { pos: string; by: string[] }[];
    }[];
    const copy = structuredClone(e);
    expect(compareField(k, e, copy)).toBeNull();
    expect(compareField(k, e, [...copy].reverse())).not.toBeNull();
    const byOrder = structuredClone(e);
    const firstHit = byOrder[0]?.hits[0];
    if (!firstHit) throw new Error('C01 应有吉神');
    firstHit.by = ['日干', '年干'];
    expect(compareField(k, e, byOrder)).not.toBeNull();
    expect(compareField(k, e, copy.slice(1))).not.toBeNull();
  });

  it('yongshen 喜神顺序有意义（C20 原用神保留为第一喜神）', () => {
    const k = check('yongshen').kind;
    const e = byId('C20').expected.yongshen as { yong: string; xi: string[] };
    expect(compareField(k, e, structuredClone(e))).toBeNull();
    expect(compareField(k, e, { ...e, xi: [...e.xi].reverse() })).not.toBeNull();
  });

  it('三柱时柱期望为 null 时，实际必须也是 null', () => {
    const k = check('pillars.hour').kind;
    expect(compareField(k, null, null)).toBeNull();
    expect(compareField(k, null, '甲子')).not.toBeNull();
    expect(compareField(k, null, undefined)).not.toBeNull();
  });
});

describe('checkCaseField：待实现 / 待复核 / 不适用 / 未输出', () => {
  it('在待实现清单中 → pending，不比对', () => {
    const r = checkCaseField(
      check('pillars.year'),
      byId('C01').expected,
      {},
      { 'pillars.year': 'T04' },
    );
    expect(r.outcome).toBe('pending');
    expect(r.detail).toContain('T04');
  });

  it('已移出待实现清单但实现没输出 → fail（不能静默通过）', () => {
    const r = checkCaseField(check('pillars.year'), byId('C01').expected, {}, {});
    expect(r.outcome).toBe('fail');
  });

  it('期望值为 null 表示待复核 → pendingReview（C20 起运）', () => {
    expect(checkCaseField(check('dayun.qiyun_date'), byId('C20').expected, {}, {}).outcome).toBe(
      'pendingReview',
    );
    expect(
      checkCaseField(check('dayun.first3.start_year'), byId('C20').expected, {}, {}).outcome,
    ).toBe('pendingReview');
    // 同一案例的大运干支有值，照常比对
    expect(checkCaseField(check('dayun.first3.ganzhi'), byId('C20').expected, {}, {}).outcome).toBe(
      'fail',
    );
  });

  it('三柱案例没有大运期望 → absent', () => {
    expect(checkCaseField(check('dayun.direction'), byId('C18').expected, {}, {}).outcome).toBe(
      'absent',
    );
  });

  it('用期望值自身作为实际输出时，全部案例全部字段通过（比对工具自洽）', () => {
    const get = (o: unknown, path: string): unknown =>
      path
        .split('.')
        .reduce<unknown>((cur, k) => (cur as Record<string, unknown> | undefined)?.[k], o);
    for (const c of cases) {
      const e = c.expected;
      const first3 = (
        e.dayun as { first3?: { ganzhi: string; start_year: number | null }[] } | undefined
      )?.first3;
      const actual: Record<string, unknown> = {
        'pillars.year': e.pillars.year,
        'pillars.month': e.pillars.month,
        'pillars.day': e.pillars.day,
        'pillars.hour': e.pillars.hour,
        'alt.zi_huanri_day_pillar': get(e, 'alt_zi_huanri_school.day'),
        'dayun.direction': get(e, 'dayun.direction'),
        'dayun.first3.ganzhi': first3?.map((s) => s.ganzhi),
        'dayun.first3.start_year': first3?.map((s) => s.start_year),
        'dayun.qiyun_date': get(e, 'dayun.qiyun_date'),
        'strength.S': get(e, 'strength.S'),
        'strength.power': get(e, 'strength.power'),
        'strength.gods': get(e, 'strength.gods'),
        'strength.de_ling': get(e, 'strength.de_ling'),
        'strength.de_di': get(e, 'strength.de_di'),
        'strength.de_shi': get(e, 'strength.de_shi'),
        'strength.level': get(e, 'strength.level'),
        'strength.special': get(e, 'strength.special'),
        'strength.borderline': get(e, 'strength.borderline'),
        yongshen: structuredClone(e.yongshen),
        rules_hit: ['S-POWER', ...(e.rules_hit_expected as string[]), 'S-LEVEL'],
        shensha_ji: structuredClone(e.shensha_ji),
      };
      for (const fc of FIELD_CHECKS) {
        const r = checkCaseField(fc, e, actual, {});
        expect(['pass', 'absent', 'pendingReview'], `${c.id} ${fc.key}: ${r.detail}`).toContain(
          r.outcome,
        );
      }
    }
  });
});

describe('字段注册表守卫', () => {
  it('字段键唯一；待实现清单只含已注册的字段', () => {
    const keys = FIELD_CHECKS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of Object.keys(PENDING_FIELDS)) expect(keys).toContain(k);
  });

  it('cases.json 每个 expected 字段要么被比对、要么在「不比对」清单中声明原因', () => {
    for (const c of cases) expect(uncoveredFields(c.expected), c.id).toEqual([]);
  });

  it('cases.json 新增未声明字段时守卫会报出来', () => {
    const e = structuredClone(byId('C01').expected);
    (e.strength as Record<string, unknown>).new_field = 1;
    (e as Record<string, unknown>).another = [];
    expect(uncoveredFields(e)).toEqual(['strength.new_field', 'another']);
  });

  it('「不比对」清单每项都写了原因', () => {
    for (const [k, why] of Object.entries(NOT_COMPARED)) expect(why.length, k).toBeGreaterThan(0);
  });
});
