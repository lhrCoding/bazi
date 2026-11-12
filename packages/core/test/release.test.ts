/**
 * T38 素材发布快照与比对（texts/README.md §5.2、§9.3）。
 * 验收：用 fixture 素材走一遍发布；删除已批准条目的变体时发布失败。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRelease,
  compareWithPrevious,
  SnapshotSchema,
  type Snapshot,
} from '../src/texts/release';
import type { TextEntry } from '../src/texts/schema';
import { parseTextsFiles } from '../src/texts/yaml';

const dir = fileURLToPath(new URL('./fixtures/texts/', import.meta.url));
const fixture = parseTextsFiles(
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((file) => ({ file, source: readFileSync(dir + file, 'utf8') })),
).map((e): TextEntry => ({ ...e, status: 'approved', reviewer: '用户（T1、2026-11-12）' }));
const META = { rulesVersion: 'abcd1234', releasedAt: '2026-11-12' };
const OK = { lint: [], staticCoverage: [], dynamic: [] };
const edit = (id: string, f: (e: TextEntry) => TextEntry): TextEntry[] =>
  fixture.map((e) => (e.id === id ? f(e) : e));

function v1(): Snapshot {
  const r = buildRelease(fixture, null, META, OK);
  if (!r.snapshot) throw new Error(r.problems.join('\n'));
  return r.snapshot;
}

describe('首次发布', () => {
  it('fixture 素材 → v1：只含 approved、按 id 排序、通过快照 schema', () => {
    const s = v1();
    expect(s.textsVersion).toBe(1);
    expect(s.entries.map((e) => e.id)).toEqual([...fixture.map((e) => e.id)].sort());
    expect(SnapshotSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });
  it('非 approved 条目不进入快照', () => {
    const src = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, status: 'reviewed' }));
    expect(buildRelease(src, null, META, OK).snapshot?.entries.map((e) => e.id)).not.toContain(
      'CH3-SHENSHA-ANY',
    );
  });
  it('lint / 静态覆盖率 / 动态抽样任一有问题即拒绝；没有 approved 条目拒绝', () => {
    const r = buildRelease(fixture, null, META, {
      lint: ['X L4 禁用词'],
      staticCoverage: ['CH1 缺口'],
      dynamic: ['兜底 3 次'],
    });
    expect(r.snapshot).toBeNull();
    expect(r.problems).toEqual([
      'lint：X L4 禁用词',
      '静态覆盖率：CH1 缺口',
      '动态抽样：兜底 3 次',
    ]);
    expect(
      buildRelease(
        fixture.map((e) => ({ ...e, status: 'draft' as const })),
        null,
        META,
        OK,
      ).problems,
    ).toEqual(['没有 approved 条目，无可发布内容']);
  });
});

describe('与上一快照比对：approved 条目只许追加变体', () => {
  const prev = v1();
  it('追加变体 → v2 发布成功', () => {
    const src = edit('CH3-SHENSHA-ANY', (e) => ({
      ...e,
      variants: [...e.variants, '【测试素材】第三个变体。'],
    }));
    const r = buildRelease(src, prev, META, OK);
    expect(r.problems).toEqual([]);
    expect(r.snapshot?.textsVersion).toBe(2);
  });
  it('删除已批准条目的变体 → 发布失败', () => {
    const src = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, variants: e.variants.slice(0, 1) }));
    const r = buildRelease(src, prev, META, OK);
    expect(r.snapshot).toBeNull();
    expect(r.problems).toEqual([
      'CH3-SHENSHA-ANY：已批准条目的变体被删除、修改或调整顺序（只允许在末尾追加）',
    ]);
  });
  it('修改变体文字 / 调整顺序 → 失败', () => {
    const changed = edit('CH3-SHENSHA-ANY', (e) => ({
      ...e,
      variants: [e.variants[0] + '改', ...e.variants.slice(1)],
    }));
    expect(compareWithPrevious(prev, changed)).toHaveLength(1);
    const swapped = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, variants: [...e.variants].reverse() }));
    expect(compareWithPrevious(prev, swapped)).toHaveLength(1);
  });
  it('修改触发条件 / 优先级 → 失败', () => {
    const src = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, when: {}, priority: 60 }));
    expect(compareWithPrevious(prev, src)).toEqual([
      'CH3-SHENSHA-ANY：已批准条目的 when 被修改',
      'CH3-SHENSHA-ANY：已批准条目的 priority 被修改',
    ]);
  });
  it('直接删除已批准条目 → 失败；退役（retired）→ 允许且不进入新快照；退回 draft → 失败', () => {
    const removed = fixture.filter((e) => e.id !== 'CH3-SHENSHA-ANY');
    expect(compareWithPrevious(prev, removed)[0]).toMatch(/已批准的条目被删除/);
    const retired = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, status: 'retired' }));
    const r = buildRelease(retired, prev, META, OK);
    expect(r.problems).toEqual([]);
    expect(r.snapshot?.entries.map((e) => e.id)).not.toContain('CH3-SHENSHA-ANY');
    const draft = edit('CH3-SHENSHA-ANY', (e) => ({ ...e, status: 'draft' }));
    expect(compareWithPrevious(prev, draft)[0]).toMatch(/现状态为 draft/);
  });
});
