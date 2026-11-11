/**
 * T23 条件树求值器（rules/texts/README.md §4）。
 * 验收：每个运算符真 / 假 / null 三种用例；深度超限报错；属性测试：not(x) 在非 null 时与 x 相反。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  conditionDepth,
  conditionFields,
  ConditionError,
  entryMatches,
  evaluateCondition,
  MAX_CONDITION_DEPTH,
  resolveField,
  specificity,
} from '../src/texts/condition';
import { ALL_FIELDS } from '../src/texts/fields';
import type { Condition } from '../src/texts/schema';
import { parseTextsFiles } from '../src/texts/yaml';

const ctx = {
  day: { stem: '甲', element: '木' },
  strength: { direction: '偏弱', special: null, S_pct: 42, borderline: false },
  gods: { 财_pct: 41 },
  yongshen: { ji: ['土', '金'], th: null },
  ten_gods: { hour_stem: null },
  item: {
    relations: [
      { type: '冲', a: '流年支', b: '日支' },
      { type: '合', a: '流年支', b: '月支' },
    ],
  },
};
const ev = (c: Condition): boolean => evaluateCondition(c, ctx);

describe('叶子运算符：真 / 假 / null', () => {
  // [运算符, 为真的条件, 为假的条件, 字段为 null 的条件]
  const table: [string, Condition, Condition, Condition][] = [
    [
      'eq',
      { f: 'day.stem', eq: '甲' },
      { f: 'day.stem', eq: '乙' },
      { f: 'strength.special', eq: '从财' },
    ],
    [
      'ne',
      { f: 'day.stem', ne: '乙' },
      { f: 'day.stem', ne: '甲' },
      { f: 'strength.special', ne: '从财' },
    ],
    [
      'in',
      { f: 'day.stem', in: ['甲', '乙'] },
      { f: 'day.stem', in: ['丙'] },
      { f: 'yongshen.th', in: ['AGREE'] },
    ],
    [
      'not_in',
      { f: 'day.stem', not_in: ['丙'] },
      { f: 'day.stem', not_in: ['甲', '乙'] },
      { f: 'yongshen.th', not_in: ['AGREE'] },
    ],
    [
      'contains',
      { f: 'yongshen.ji', contains: '金' },
      { f: 'yongshen.ji', contains: '火' },
      { f: 'ten_gods.hour_stem', contains: '甲' },
    ],
    [
      'not_contains',
      { f: 'yongshen.ji', not_contains: '火' },
      { f: 'yongshen.ji', not_contains: '金' },
      { f: 'ten_gods.hour_stem', not_contains: '甲' },
    ],
    [
      'gte',
      { f: 'strength.S_pct', gte: 42 },
      { f: 'strength.S_pct', gte: 43 },
      { f: 'yongshen.th', gte: 0 },
    ],
    [
      'gt',
      { f: 'strength.S_pct', gt: 41 },
      { f: 'strength.S_pct', gt: 42 },
      { f: 'yongshen.th', gt: 0 },
    ],
    [
      'lte',
      { f: 'strength.S_pct', lte: 42 },
      { f: 'strength.S_pct', lte: 41 },
      { f: 'yongshen.th', lte: 100 },
    ],
    [
      'lt',
      { f: 'strength.S_pct', lt: 43 },
      { f: 'strength.S_pct', lt: 42 },
      { f: 'yongshen.th', lt: 100 },
    ],
    [
      'exists',
      { f: 'day.stem', exists: true },
      { f: 'day.stem', exists: false },
      { f: 'yongshen.th', exists: true },
    ],
  ];
  for (const [op, t, f, n] of table) {
    it(`${op}：真 / 假 / null 为假`, () => {
      expect(ev(t)).toBe(true);
      expect(ev(f)).toBe(false);
      expect(ev(n)).toBe(false);
    });
  }

  it('exists:false 是 null 时唯一为真的叶子；不存在的字段等同 null', () => {
    expect(ev({ f: 'yongshen.th', exists: false })).toBe(true);
    expect(ev({ f: 'no.such', exists: false })).toBe(true);
    expect(ev({ f: 'no.such', ne: '甲' })).toBe(false);
  });

  it('布尔字段用 eq；数值边界', () => {
    expect(ev({ f: 'strength.borderline', eq: false })).toBe(true);
    expect(ev({ f: 'strength.borderline', eq: true })).toBe(false);
    expect(ev({ f: 'gods.财_pct', lt: 41 })).toBe(false);
    expect(ev({ f: 'gods.财_pct', lte: 41 })).toBe(true);
  });

  it('类型不符一律为假（对列表用 eq、对字符串用 gte、对标量用 contains）', () => {
    expect(ev({ f: 'yongshen.ji', eq: '土' })).toBe(false);
    expect(ev({ f: 'yongshen.ji', ne: '土' })).toBe(false);
    expect(ev({ f: 'day.stem', gte: 1 })).toBe(false);
    expect(ev({ f: 'day.stem', contains: '甲' })).toBe(false);
    expect(ev({ f: 'day.stem', not_contains: '甲' })).toBe(false);
  });

  it('contains 对象：对象列表按给出的键全部相等匹配', () => {
    expect(ev({ f: 'item.relations', contains: { type: '冲', a: '流年支', b: '日支' } })).toBe(
      true,
    );
    expect(ev({ f: 'item.relations', contains: { type: '冲', b: '日支' } })).toBe(true);
    expect(ev({ f: 'item.relations', contains: { type: '冲', a: '流年支', b: '月支' } })).toBe(
      false,
    );
    expect(ev({ f: 'item.relations', not_contains: { type: '冲', b: '时支' } })).toBe(true);
    expect(ev({ f: 'item.relations', contains: '冲' })).toBe(false);
  });

  it('只取自身属性：原型链上的名字视为不存在', () => {
    expect(resolveField(ctx, 'day.toString')).toBeUndefined();
    expect(resolveField(ctx, 'constructor')).toBeUndefined();
    expect(ev({ f: '__proto__', exists: true })).toBe(false);
  });
});

describe('组合子', () => {
  it('{} 恒为真；all / any / not', () => {
    expect(ev({})).toBe(true);
    expect(
      ev({
        all: [
          { f: 'day.stem', eq: '甲' },
          { f: 'strength.direction', eq: '偏弱' },
        ],
      }),
    ).toBe(true);
    expect(
      ev({
        all: [
          { f: 'day.stem', eq: '甲' },
          { f: 'strength.direction', eq: '偏旺' },
        ],
      }),
    ).toBe(false);
    expect(
      ev({
        any: [
          { f: 'day.stem', eq: '乙' },
          { f: 'strength.direction', eq: '偏弱' },
        ],
      }),
    ).toBe(true);
    expect(
      ev({
        any: [
          { f: 'day.stem', eq: '乙' },
          { f: 'strength.direction', eq: '偏旺' },
        ],
      }),
    ).toBe(false);
    expect(ev({ not: { f: 'day.stem', eq: '乙' } })).toBe(true);
  });

  it('not 只对结果取反：子条件字段为 null 时 not 为真（README §4.1 示例「not exists」写法依赖这一点）', () => {
    expect(ev({ not: { f: 'strength.special', exists: true } })).toBe(true);
    expect(ev({ not: { f: 'strength.special', eq: '从财' } })).toBe(true);
  });

  it('README §4.1 示例', () => {
    const c: Condition = {
      all: [
        { f: 'strength.direction', eq: '偏弱' },
        { f: 'gods.top_yidang', in: ['官杀', '食伤'] },
        {
          any: [
            { f: 'month.season', eq: '冬' },
            { f: 'power_pct.火', lt: 10 },
          ],
        },
        { not: { f: 'strength.special', exists: true } },
      ],
    };
    const base = { strength: { direction: '偏弱', special: null }, gods: { top_yidang: '官杀' } };
    expect(evaluateCondition(c, { ...base, month: { season: '冬' }, power_pct: { 火: 30 } })).toBe(
      true,
    );
    expect(evaluateCondition(c, { ...base, month: { season: '夏' }, power_pct: { 火: 5 } })).toBe(
      true,
    );
    expect(evaluateCondition(c, { ...base, month: { season: '夏' }, power_pct: { 火: 30 } })).toBe(
      false,
    );
    expect(conditionDepth(c)).toBe(2);
    expect(specificity(c)).toBe(5);
    expect(conditionFields(c)).toEqual([
      'strength.direction',
      'gods.top_yidang',
      'month.season',
      'power_pct.火',
      'strength.special',
    ]);
  });
});

describe('深度与特异度', () => {
  const leaf: Condition = { f: 'day.stem', eq: '甲' };
  const nest = (n: number): Condition => (n === 0 ? leaf : { all: [nest(n - 1)] });

  it(`深度 ≤ ${MAX_CONDITION_DEPTH} 可求值，超限抛 ConditionError`, () => {
    expect(conditionDepth(nest(3))).toBe(3);
    expect(evaluateCondition(nest(3), ctx)).toBe(true);
    expect(() => evaluateCondition(nest(4), ctx)).toThrow(ConditionError);
    expect(() => evaluateCondition({ not: { not: { not: { not: leaf } } } }, ctx)).toThrow(
      /深度 4/,
    );
  });

  it('深度取最深分支；叶子与 {} 为 0', () => {
    expect(conditionDepth({})).toBe(0);
    expect(conditionDepth(leaf)).toBe(0);
    expect(conditionDepth({ any: [leaf, nest(2)] })).toBe(3);
  });

  it('特异度 = 叶子个数', () => {
    expect(specificity({})).toBe(0);
    expect(specificity(leaf)).toBe(1);
    expect(specificity({ all: [leaf, { not: leaf }, { any: [leaf, leaf] }] })).toBe(4);
  });

  it('非法结构抛错（不会静默为真 / 假）', () => {
    expect(() => evaluateCondition({ foo: 1 } as unknown as Condition, ctx)).toThrow(
      ConditionError,
    );
    expect(() => evaluateCondition({ all: [] } as Condition, ctx)).toThrow(ConditionError);
    expect(() =>
      evaluateCondition({ f: 'day.stem', eq: '甲', ne: '乙' } as Condition, ctx),
    ).toThrow(ConditionError);
    expect(() =>
      evaluateCondition({ f: 'day.stem', like: '甲' } as unknown as Condition, ctx),
    ).toThrow(ConditionError);
  });

  it('不 eval：字符串值只做相等比较', () => {
    const evil = 'globalThis.__pwned = 1';
    expect(ev({ f: 'day.stem', eq: evil })).toBe(false);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });
});

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

describe('属性测试（固定种子）', () => {
  // 只用有取值域的标量 / 列表 / 整数字段
  const fields = Object.entries(ALL_FIELDS).filter(
    ([, s]) => s.kind !== 'objectList' && s.kind !== 'text',
  );
  const r = rng(20261111);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)] as T;

  function randomValue(path: string): unknown {
    const s = ALL_FIELDS[path];
    if (!s) return null;
    switch (s.kind) {
      case 'enum':
        return pick(s.domain);
      case 'bool':
        return r() < 0.5;
      case 'int':
        return s.min + Math.floor(r() * (Math.min(s.max, s.min + 100) - s.min + 1));
      case 'list':
        return s.domain.filter(() => r() < 0.4);
      default:
        return null;
    }
  }
  function setPath(o: Record<string, unknown>, path: string, v: unknown): void {
    const keys = path.split('.');
    let cur = o;
    for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
    cur[keys.at(-1) as string] = v;
  }
  function randomLeaf(path: string): Condition {
    const s = ALL_FIELDS[path];
    const v = randomValue(path);
    if (s?.kind === 'int')
      return { f: path, [pick(['gte', 'gt', 'lte', 'lt', 'eq', 'ne'])]: v } as Condition;
    if (s?.kind === 'list') {
      const el = pick((s as { domain: readonly string[] }).domain);
      return { f: path, [pick(['contains', 'not_contains'])]: el } as Condition;
    }
    if (s?.kind === 'enum') {
      const op = pick(['eq', 'ne', 'in', 'not_in', 'exists']);
      if (op === 'in' || op === 'not_in')
        return { f: path, [op]: [v, pick(s.domain)] } as Condition;
      if (op === 'exists') return { f: path, exists: r() < 0.5 };
      return { f: path, [op]: v } as Condition;
    }
    return { f: path, [pick(['eq', 'ne'])]: r() < 0.5 } as Condition;
  }

  it('not(x) 在字段非 null 时与 x 相反；ne / not_in / not_contains 与 eq / in / contains 互补（2000 组）', () => {
    for (let i = 0; i < 2000; i++) {
      const [path] = pick(fields);
      const c: Record<string, unknown> = {};
      setPath(c, path, randomValue(path));
      const x = randomLeaf(path);
      const vx = evaluateCondition(x, c);
      expect(evaluateCondition({ not: x }, c), JSON.stringify([x, c])).toBe(!vx);
      const op = Object.keys(x).find((k) => k !== 'f') as string;
      const dual: Record<string, string> = {
        eq: 'ne',
        ne: 'eq',
        in: 'not_in',
        not_in: 'in',
        contains: 'not_contains',
        not_contains: 'contains',
      };
      const d = dual[op];
      if (d !== undefined) {
        const y = { f: path, [d]: (x as Record<string, unknown>)[op] } as Condition;
        expect(evaluateCondition(y, c), JSON.stringify([x, y, c])).toBe(!vx);
      }
    }
  });

  it('字段为 null 时：除 exists:false 外的叶子全部为假（2000 组）', () => {
    for (let i = 0; i < 2000; i++) {
      const [path] = pick(fields);
      const c: Record<string, unknown> = {};
      setPath(c, path, null);
      const x = randomLeaf(path);
      const expected = (x as Record<string, unknown>).exists === false;
      expect(evaluateCondition(x, c), JSON.stringify(x)).toBe(expected);
    }
  });

  it('德摩根：not(all(a,b)) = any(not a, not b)', () => {
    for (let i = 0; i < 1000; i++) {
      const [p1] = pick(fields);
      const [p2] = pick(fields);
      const c: Record<string, unknown> = {};
      setPath(c, p1, r() < 0.2 ? null : randomValue(p1));
      setPath(c, p2, r() < 0.2 ? null : randomValue(p2));
      const a = randomLeaf(p1);
      const b = randomLeaf(p2);
      expect(evaluateCondition({ not: { all: [a, b] } }, c)).toBe(
        evaluateCondition({ any: [{ not: a }, { not: b }] }, c),
      );
    }
  });
});

describe('rules/texts 实际素材', () => {
  const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
  const entries = parseTextsFiles(
    readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
      .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
  );

  it('全部 when / asserts 深度 ≤ 3，且可在空上下文上求值（不抛错）', () => {
    for (const e of entries) {
      for (const c of [e.when, ...e.asserts]) {
        expect(conditionDepth(c), e.id).toBeLessThanOrEqual(MAX_CONDITION_DEPTH);
        expect(() => evaluateCondition(c, {}), e.id).not.toThrow();
      }
    }
  });

  it('样例：CH1-BALANCE-W-GUANSHA 与 CH6-REL-CHONG-RIZHI 在对应上下文中命中', () => {
    const byId = (id: string) => {
      const e = entries.find((x) => x.id === id);
      if (!e) throw new Error(id);
      return e;
    };
    expect(
      entryMatches(byId('CH1-BALANCE-W-GUANSHA'), {
        strength: { direction: '偏弱' },
        gods: { top_yidang: '官杀' },
      }),
    ).toBe(true);
    expect(
      entryMatches(byId('CH1-BALANCE-W-GUANSHA'), {
        strength: { direction: '偏旺' },
        gods: { top_yidang: '官杀' },
      }),
    ).toBe(false);
    expect(entryMatches(byId('CH6-REL-CHONG-RIZHI'), ctx)).toBe(true);
  });

  it('entryMatches：asserts 不成立时不可选', () => {
    const e = { when: {}, asserts: [{ f: 'day.stem', eq: '乙' } as Condition] };
    expect(entryMatches(e, ctx)).toBe(false);
    expect(entryMatches({ when: {}, asserts: [] }, ctx)).toBe(true);
  });
});
