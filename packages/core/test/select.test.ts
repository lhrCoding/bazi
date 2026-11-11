/**
 * T29 槽位选段与变体确定性选择（rules/texts/README.md §5.1、§5.2）。
 * 验收：排序规则（priority → 特异度 → id）；同输入多次选择结果相同；循环槽位同条目再次命中按新 occurrence 重新取模
 * （用户 2026-10-30 决定，可能与上次相同）；固定向量测试哈希取模；必需槽位缺兜底时抛启动期错误。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart } from '../src/index';
import { buildCtx } from '../src/report/ctx';
import {
  assertLibraryComplete,
  createLibrary,
  libraryProblems,
  selectSlot,
  TextLibraryError,
  VariantChooser,
  variantIndex,
} from '../src/report/select';
import type { TextEntry } from '../src/texts/schema';
import { parseTextsFiles } from '../src/texts/yaml';
import { loadCases } from './helpers/cases';

function e(id: string, over: Partial<TextEntry> = {}): TextEntry {
  return {
    id,
    slot: 'CH1-DAYMASTER',
    when: { f: 'day.stem', eq: '甲' },
    asserts: [],
    priority: 50,
    fallback: false,
    requires_hour: false,
    length: [1, 300],
    variants: [`${id} 变体一`, `${id} 变体二`],
    status: 'approved',
    author: 'x',
    reviewer: '用户',
    updated: '2026-11-11',
    ...over,
  };
}
const ctx = {
  day: { stem: '甲', element: '木' },
  profile: { time_known: true },
  yongshen: { xian: [] },
};
const ids = (p: { entries: TextEntry[] }) => p.entries.map((x) => x.id);

describe('排序：priority 降序 → 特异度降序 → id 升序', () => {
  it('三个键依次生效', () => {
    const lib = createLibrary([
      e('CH1-DAYMASTER-C'),
      e('CH1-DAYMASTER-A'),
      e('CH1-DAYMASTER-HI', { priority: 80 }),
      e('CH1-DAYMASTER-SPEC', {
        when: {
          all: [
            { f: 'day.stem', eq: '甲' },
            { f: 'day.element', eq: '木' },
          ],
        },
      }),
    ]);
    expect(ids(selectSlot(lib, 'CH1-DAYMASTER', ctx, 4))).toEqual([
      'CH1-DAYMASTER-HI',
      'CH1-DAYMASTER-SPEC',
      'CH1-DAYMASTER-A',
      'CH1-DAYMASTER-C',
    ]);
    expect(ids(selectSlot(lib, 'CH1-DAYMASTER', ctx, 1))).toEqual(['CH1-DAYMASTER-HI']);
  });
});

describe('过滤', () => {
  it('status 允许集合可配置（默认只要 approved）', () => {
    const list = [
      e('CH1-DAYMASTER-A', { status: 'draft' }),
      e('CH1-DAYMASTER-B', { status: 'reviewed' }),
    ];
    expect(ids(selectSlot(createLibrary(list), 'CH1-DAYMASTER', ctx, 2))).toEqual([]);
    expect(
      ids(selectSlot(createLibrary(list, ['approved', 'reviewed']), 'CH1-DAYMASTER', ctx, 2)),
    ).toEqual(['CH1-DAYMASTER-B']);
    expect(
      ids(
        selectSlot(createLibrary(list, ['draft', 'reviewed', 'approved']), 'CH1-DAYMASTER', ctx, 2),
      ),
    ).toHaveLength(2);
  });
  it('when 与 asserts 都要成立', () => {
    const lib = createLibrary([
      e('CH1-DAYMASTER-A', { when: { f: 'day.stem', eq: '乙' } }),
      e('CH1-DAYMASTER-B', { asserts: [{ f: 'day.element', eq: '火' }] }),
      e('CH1-DAYMASTER-C'),
    ]);
    expect(ids(selectSlot(lib, 'CH1-DAYMASTER', ctx, 3))).toEqual(['CH1-DAYMASTER-C']);
  });
  it('requires_hour 的条目三柱时排除', () => {
    const lib = createLibrary([
      e('CH1-DAYMASTER-H', { requires_hour: true }),
      e('CH1-DAYMASTER-N'),
    ]);
    expect(ids(selectSlot(lib, 'CH1-DAYMASTER', ctx, 2))).toHaveLength(2);
    expect(
      ids(selectSlot(lib, 'CH1-DAYMASTER', { ...ctx, profile: { time_known: false } }, 2)),
    ).toEqual(['CH1-DAYMASTER-N']);
  });
  it('占位符不可解析（null、不存在、空列表）→ 不可选', () => {
    const lib = createLibrary([
      e('CH1-DAYMASTER-NULL', { variants: ['{ten_gods.hour_stem}', 'b'] }),
      e('CH1-DAYMASTER-MISS', { variants: ['a', '{no.such}'] }),
      e('CH1-DAYMASTER-EMPTY', { variants: ['闲神 {yongshen.xian}', 'b'] }),
      e('CH1-DAYMASTER-OK', { variants: ['{day.stem}{day.element}', 'b'] }),
    ]);
    expect(
      ids(selectSlot(lib, 'CH1-DAYMASTER', { ...ctx, ten_gods: { hour_stem: null } }, 4)),
    ).toEqual(['CH1-DAYMASTER-OK']);
  });
  it('循环槽位：条件可引用 item.*', () => {
    const lib = createLibrary([
      e('CH6-HEAD-QISHA-HAO', {
        slot: 'CH6-HEAD',
        when: { all: [{ f: 'item.stem_ten_god', eq: '七杀' }] },
      }),
    ]);
    expect(ids(selectSlot(lib, 'CH6-HEAD', ctx, 1, { stem_ten_god: '七杀' }))).toEqual([
      'CH6-HEAD-QISHA-HAO',
    ]);
    expect(ids(selectSlot(lib, 'CH6-HEAD', ctx, 1, { stem_ten_god: '正官' }))).toEqual([]);
  });
});

describe('兜底', () => {
  const fb = e('CH1-DAYMASTER-FALLBACK', {
    when: {},
    fallback: true,
    priority: 0,
    variants: ['兜底'],
  });
  it('候选为空才用兜底，并标记 fallbackUsed；兜底不参与正常排序', () => {
    const lib = createLibrary([e('CH1-DAYMASTER-A'), fb]);
    expect(selectSlot(lib, 'CH1-DAYMASTER', ctx, 2)).toMatchObject({ fallbackUsed: false });
    expect(ids(selectSlot(lib, 'CH1-DAYMASTER', ctx, 2))).toEqual(['CH1-DAYMASTER-A']);
    const p = selectSlot(lib, 'CH1-DAYMASTER', { ...ctx, day: { stem: '乙' } }, 1);
    expect(p).toMatchObject({ fallbackUsed: true });
    expect(ids(p)).toEqual(['CH1-DAYMASTER-FALLBACK']);
  });
  it('同槽位两条兜底 → 建库报错', () => {
    expect(() => createLibrary([fb, { ...fb, id: 'CH1-DAYMASTER-FALLBACK2' }])).toThrow(
      TextLibraryError,
    );
  });
  it('启动期检查：必需槽位缺兜底抛错，列出缺口；固定文本槽位有 {} 条目即可', () => {
    const lib = createLibrary([fb]);
    const p = libraryProblems(lib);
    expect(p).not.toContain('CH1-DAYMASTER：必需槽位没有兜底条目');
    expect(p).toContain('CH1-MONTH：必需槽位没有兜底条目');
    expect(p.some((x) => x.startsWith('CH2-SUMMARY'))).toBe(false); // 代码模板
    expect(() => assertLibraryComplete(lib)).toThrow(TextLibraryError);
    const fixed = createLibrary([
      e('CH4-NOTE-FIXED', { slot: 'CH4-NOTE', when: {}, variants: ['固定'] }),
    ]);
    expect(libraryProblems(fixed)).not.toContain('CH4-NOTE：必需槽位没有兜底条目');
  });
});

describe('变体选择（§5.2）', () => {
  // 期望值由 Node crypto 独立计算：sha256(utf8) 前 8 字节大端 mod n
  const vectors: [string, string, number, number, number][] = [
    ['癸酉乙丑乙未己卯|女|1', 'CH1-DAYMASTER-YI', 0, 2, 1],
    ['癸酉乙丑乙未己卯|女|1', 'CH1-DAYMASTER-YI', 1, 2, 1],
    ['癸酉乙丑乙未己卯|女|1', 'CH6-CAREER-CAI-SHOU', 0, 3, 0],
    ['庚午辛巳乙酉--|女|0', 'CH1-MONTH-MU-GUANSHA', 0, 2, 0],
    ['癸卯乙丑戊戌庚申|男|1', 'CH6-HEAD-SHANGGUAN-HAO', 2, 3, 0],
  ];
  for (const [k, id, occ, n, want] of vectors) {
    it(`固定向量 ${k} | ${id} | ${occ} mod ${n} = ${want}`, () =>
      expect(variantIndex(k, id, occ, n)).toBe(want));
  }
  it('n = 1 恒为 0；n 非法报错', () => {
    expect(variantIndex('x', 'y', 0, 1)).toBe(0);
    expect(() => variantIndex('x', 'y', 0, 0)).toThrow();
  });
  it('VariantChooser：同一条目第二次命中用 occurrence = 1 重新取模（可能与第一次相同，见 YI 向量）', () => {
    const ch = new VariantChooser('癸酉乙丑乙未己卯|女|1');
    const yi = e('CH1-DAYMASTER-YI');
    const a = ch.choose(yi);
    const b = ch.choose(yi);
    expect([a.occurrence, b.occurrence]).toEqual([0, 1]);
    expect([a.variantIndex, b.variantIndex]).toEqual([1, 1]);
    expect(a.text).toBe('CH1-DAYMASTER-YI 变体二');
  });
  it('第二次命中会换变体的例子：在 occurrence 0 / 1 取模结果不同的条目上验证换了', () => {
    const k = '癸酉乙丑乙未己卯|女|1';
    const id = Array.from({ length: 50 }, (_, i) => `CH6-HEAD-T${i}`).find(
      (x) => variantIndex(k, x, 0, 2) !== variantIndex(k, x, 1, 2),
    ) as string;
    const ch = new VariantChooser(k);
    const ent = e(id, { slot: 'CH6-HEAD' });
    expect(ch.choose(ent).text).not.toBe(ch.choose(ent).text);
  });
  it('同输入多次选择结果相同（新选择器从 0 计数）', () => {
    const ent = e('CH6-CAREER-CAI-SHOU', { variants: ['a', 'b', 'c'] });
    const run = () => {
      const ch = new VariantChooser('癸酉乙丑乙未己卯|女|1');
      return [ch.choose(ent).text, ch.choose(ent).text, ch.choose(ent).text];
    };
    expect(run()).toEqual(run());
  });
});

describe('真实素材 + 真实案例（开发期允许 draft）', () => {
  const dir = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
  const entries = parseTextsFiles(
    readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml')
      .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
  );
  const lib = createLibrary(entries, ['draft', 'reviewed', 'approved']);
  const REF = Date.parse('2026-10-30T00:00:00+08:00');
  const { cases } = loadCases();

  it('生产口径（只要 approved）当前没有可用素材：第 1 批尚未批准', () => {
    expect(createLibrary(entries).bySlot.size).toBe(0);
  });

  it('C16：第 1、2 章必需槽位与第 6 章逐年槽位都选到非兜底条目，且两次运行结果相同', () => {
    const c = cases.find((x) => x.id === 'C16');
    const chart = computeChart(c?.input as never, REF);
    const cx = buildCtx(chart, analyze(chart)) as unknown as Record<string, unknown>;
    const run = () => {
      const ch = new VariantChooser(cx.chart_key as string);
      const out: string[] = [];
      for (const s of [
        'CH1-DAYMASTER',
        'CH1-MONTH',
        'CH1-BALANCE',
        'CH1-CONCLUSION',
        'CH2-METHOD',
        'CH2-ROLE-YONG',
      ]) {
        const p = selectSlot(lib, s, cx, 1);
        expect(p.fallbackUsed, s).toBe(false);
        out.push(...p.entries.map((x) => `${x.id}:${ch.choose(x).variantIndex}`));
      }
      for (const item of cx.liunian as Record<string, unknown>[]) {
        for (const s of ['CH6-HEAD', 'CH6-CAREER', 'CH6-DO']) {
          const p = selectSlot(lib, s, cx, 1, item);
          expect(p.fallbackUsed, `${s} ${String(item.year)}`).toBe(false);
          out.push(...p.entries.map((x) => `${x.id}:${ch.choose(x).variantIndex}`));
        }
      }
      return out;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a[0]).toMatch(/^CH1-DAYMASTER-YI:/);
    expect(a.some((x) => x.startsWith('CH2-METHOD-W-CAI:'))).toBe(true);
  });
});
