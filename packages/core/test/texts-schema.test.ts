/**
 * T22 素材 schema、YAML 加载、字段字典（rules/texts/README.md §1–§4）。
 * 验收：rules/texts 样板文件加载通过（第 1 批全部 13 个素材文件一并加载）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { slotDef } from '../src/report/slots';
import { ALL_FIELDS, GLOBAL_FIELDS, ITEM_FIELDS, fieldSpec } from '../src/texts/fields';
import { ConditionSchema, TextEntrySchema } from '../src/texts/schema';
import {
  checkYamlSubset,
  parseTextsFiles,
  parseTextsYaml,
  TextsYamlError,
} from '../src/texts/yaml';
import { readRulesFile } from './helpers/fixtures';

const TEXTS_DIR = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const textFiles = readdirSync(TEXTS_DIR)
  .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
  .sort()
  .map((file) => ({ file, source: readFileSync(TEXTS_DIR + file, 'utf8') }));

const MIN = `- id: CH1-DAYMASTER-JIA
  slot: CH1-DAYMASTER
  when: {all: [{f: day.stem, eq: 甲}]}
  priority: 50
  length: [120, 180]
  variants:
    - "第一个变体"
    - "第二个变体"
  status: draft
  author: mingli-expert
  reviewer: null
  updated: 2026-10-29
`;

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof TextsYamlError) return [...e.problems];
    throw e;
  }
  return [];
}

describe('YAML 标准子集（AST 级）', () => {
  it('锚点、别名、显式 tag、自定义 tag、合并键都报错并带行号', () => {
    const p = checkYamlSubset('a: &x 1\nb: *x\nc: !!str 2\nd: !foo 3\ne:\n  <<: {f: 1}\n');
    expect(p.some((x) => x.includes('第 1 行') && x.includes('锚点'))).toBe(true);
    expect(p.some((x) => x.includes('第 2 行') && x.includes('别名'))).toBe(true);
    expect(p.some((x) => x.includes('第 3 行') && x.includes('tag'))).toBe(true);
    expect(p.some((x) => x.includes('第 4 行') && x.includes('tag !foo'))).toBe(true);
    expect(p.some((x) => x.includes('合并键'))).toBe(true);
  });

  it('普通写法（流式对象、引号、日期、null）不报错；日期保持为字符串', () => {
    expect(checkYamlSubset(MIN)).toEqual([]);
    expect(parseTextsYaml('t.yaml', MIN)[0]?.updated).toBe('2026-10-29');
  });

  it('重复键、语法错误报错', () => {
    expect(checkYamlSubset('a: 1\na: 2\n').length).toBeGreaterThan(0);
    expect(checkYamlSubset('a: [1, 2\n').length).toBeGreaterThan(0);
  });

  it('违规文件整体拒绝（不是跳过违规条目）', () => {
    expect(
      problemsOf(() => parseTextsYaml('t.yaml', MIN.replace('priority: 50', 'priority: &p 50'))),
    ).toHaveLength(1);
  });
});

describe('条目 schema（README §2）', () => {
  it('最小合法条目 + 默认值', () => {
    const [e] = parseTextsYaml('t.yaml', MIN);
    expect(e).toMatchObject({ asserts: [], fallback: false, requires_hour: false });
  });

  const bad: [string, string, string][] = [
    ['id 小写', MIN.replace('CH1-DAYMASTER-JIA', 'ch1-daymaster-jia'), 'id'],
    ['缺 slot', MIN.replace('  slot: CH1-DAYMASTER\n', ''), 'slot'],
    ['priority 超过 100', MIN.replace('priority: 50', 'priority: 120'), 'priority'],
    ['字数区间倒置', MIN.replace('[120, 180]', '[180, 120]'), 'length'],
    [
      '变体超过 3 个',
      MIN.replace('    - "第二个变体"\n', '    - "2"\n    - "3"\n    - "4"\n'),
      'variants',
    ],
    ['变体含换行', MIN.replace('"第一个变体"', '"第一\\n段"'), 'variants'],
    ['status 非法', MIN.replace('status: draft', 'status: done'), 'status'],
    ['未知字段', MIN.replace('status: draft', 'status: draft\n  extra: 1'), 'extra'],
    ['updated 格式', MIN.replace('2026-10-29', '2026/10/29'), 'updated'],
    ['未知运算符', MIN.replace('eq: 甲', 'like: 甲'), 'when'],
    ['叶子两个运算符', MIN.replace('eq: 甲}', 'eq: 甲, ne: 乙}'), 'when'],
    ['in 不是列表', MIN.replace('eq: 甲', 'in: 甲'), 'when'],
    ['gte 不是数', MIN.replace('{f: day.stem, eq: 甲}', '{f: strength.S_pct, gte: 高}'), 'when'],
    ['exists 不是布尔', MIN.replace('eq: 甲', 'exists: 1'), 'when'],
    ['组合子为空数组', MIN.replace('{all: [{f: day.stem, eq: 甲}]}', '{all: []}'), 'when'],
  ];
  for (const [name, src, key] of bad) {
    it(`拒绝：${name}`, () => {
      const p = problemsOf(() => parseTextsYaml('t.yaml', src));
      expect(p.length, name).toBeGreaterThan(0);
      expect(p.join('\n')).toContain(key);
    });
  }

  it('条件树：all / any / not 嵌套与对象列表 contains', () => {
    const ok = [
      {},
      {
        all: [{ f: 'strength.direction', eq: '偏弱' }, { any: [{ f: 'month.season', eq: '冬' }] }],
      },
      { not: { f: 'strength.special', exists: true } },
      { f: 'item.relations', contains: { type: '冲', a: '流年支', b: '日支' } },
      { f: 'yongshen.ji', not_contains: '火' },
      { f: 'gods.财_pct', lt: 10 },
    ];
    for (const c of ok) expect(ConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
    expect(ConditionSchema.safeParse({ f: 'x', contains: {} }).success).toBe(false);
    expect(ConditionSchema.safeParse({ all: [{}], any: [{}] }).success).toBe(false);
  });

  it('同文件 / 跨文件 id 重复报错', () => {
    expect(problemsOf(() => parseTextsYaml('t.yaml', MIN + MIN)).join()).toContain('id 重复');
    const p = problemsOf(() =>
      parseTextsFiles([
        { file: 'a.yaml', source: MIN },
        { file: 'b.yaml', source: MIN },
      ]),
    );
    expect(p.join()).toContain('a.yaml 与 b.yaml');
  });

  it('空文件 = 0 条；顶层不是数组报错', () => {
    expect(parseTextsYaml('t.yaml', '# 只有注释\n')).toEqual([]);
    expect(problemsOf(() => parseTextsYaml('t.yaml', 'a: 1\n'))).toEqual(['顶层必须是条目数组']);
  });
});

describe('rules/texts 实际素材', () => {
  it('README §11 的两个样板文件加载通过', () => {
    for (const f of ['ch01_strength.yaml', 'ch02_yongshen.yaml']) {
      const src = textFiles.find((x) => x.file === f);
      expect(src, f).toBeDefined();
      expect(parseTextsYaml(f, src?.source ?? '').length).toBeGreaterThan(0);
    }
  });

  it('全部素材文件加载通过（id 全库唯一），每条的槽位在注册表中且需要素材', () => {
    const all = parseTextsFiles(textFiles);
    expect(all.length).toBeGreaterThanOrEqual(274);
    for (const e of all) {
      const s = slotDef(e.slot);
      expect(s, `${e.id} 的槽位 ${e.slot}`).toBeDefined();
      expect(s?.source, `${e.id}：${e.slot} 是代码模板，不应有素材`).not.toBe('code');
    }
    for (const e of all) expect(TextEntrySchema.safeParse(e).success).toBe(true);
  });
});

describe('字段字典（README §3）', () => {
  it('README §3.1 / §3.2 表格中每个字段都在字典里', () => {
    const md = readRulesFile('texts/README.md');
    const sec = md.slice(md.indexOf('## 3. 可用字段字典'), md.indexOf('### 3.3'));
    const rows = sec.split('\n').filter((l) => /^\| [a-z_]/.test(l));
    const names = rows.flatMap((l) => {
      const cell = (l.split('|')[1] as string).trim();
      // 展开简写：「el.比劫 / el.印 / …」「gods.比劫_pct … gods.官杀_pct」「ten_gods.year_stem / month_stem / hour_stem」
      const parts = cell.split(/\s*(?:\/|…)\s*/).filter(Boolean);
      const prefix = (parts[0] as string).slice(0, (parts[0] as string).indexOf('.') + 1);
      return parts.map((p) => (p.includes('.') || !prefix ? p : prefix + p));
    });
    expect(names.length).toBeGreaterThan(60);
    for (const n of names) {
      if (/[…]/.test(n)) continue;
      expect(fieldSpec(n), n).toBeDefined();
    }
    // 范围写法展开后的全部成员
    for (const g of ['比劫', '印', '食伤', '财', '官杀']) {
      expect(fieldSpec(`gods.${g}_pct`)).toBeDefined();
      expect(fieldSpec(`el.${g}`)).toBeDefined();
    }
    for (const w of ['木', '火', '土', '金', '水'])
      expect(fieldSpec(`power_pct.${w}`)).toBeDefined();
  });

  it('枚举域非空且不重复；全局字段与 item 字段不重名', () => {
    for (const [k, s] of Object.entries(ALL_FIELDS)) {
      if (s.kind === 'enum' || s.kind === 'list') {
        expect(s.domain.length, k).toBeGreaterThan(0);
        expect(new Set(s.domain).size, k).toBe(s.domain.length);
      }
      if (s.kind === 'int') expect(s.min, k).toBeLessThanOrEqual(s.max);
    }
    expect(Object.keys(GLOBAL_FIELDS).filter((k) => k in ITEM_FIELDS)).toEqual([]);
    expect(Object.keys(ITEM_FIELDS).every((k) => k.startsWith('item.'))).toBe(true);
  });

  it('三柱时可能为 null 的字段标 nullable', () => {
    for (const k of [
      'ten_gods.hour_stem',
      'ten_gods.hour_branch',
      'strength.special',
      'yongshen.th',
    ]) {
      expect(fieldSpec(k)).toMatchObject({ kind: 'enum', nullable: true });
    }
    expect(fieldSpec('不存在')).toBeUndefined();
    expect(fieldSpec('toString')).toBeUndefined();
  });
});
