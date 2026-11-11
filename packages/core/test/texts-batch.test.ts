/**
 * T26 批次抽样与 YAML 改写（rules/texts/README.md §9）。
 * 验收：同一种子两次抽样结果相同；第二轮必含上轮不通过条目；approve / reject 对 YAML 的改动正确且不改动其他字段与格式。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  drawSample,
  fnv1a64,
  roundLine,
  sampleSize,
  setBatchField,
  setEntryStatus,
  upsertRound,
  type BatchRound,
} from '../src/texts/batch';
import { parseTextsYaml } from '../src/texts/yaml';

const DIR = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const read = (f: string): string => readFileSync(DIR + f, 'utf8');
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `CH1-X-${String(i).padStart(3, '0')}`);

/** 两段文本逐行比较，返回不同的行号 */
function changedLines(a: string, b: string): number[] {
  const x = a.split('\n');
  const y = b.split('\n');
  expect(y.length).toBe(x.length);
  return x.flatMap((l, i) => (l === y[i] ? [] : [i]));
}

describe('样本量', () => {
  it('10% 向上取整、至少 5、不超过总数', () => {
    expect(sampleSize(274)).toBe(28);
    expect(sampleSize(260)).toBe(26);
    expect(sampleSize(51)).toBe(6);
    expect(sampleSize(30)).toBe(5);
    expect(sampleSize(3)).toBe(3);
  });
});

describe('抽样', () => {
  const all = ids(274);

  it('同一种子两次结果相同；结果有序、无重复、都在本批', () => {
    const a = drawSample('B1', all, []);
    const b = drawSample('B1', [...all].reverse(), []);
    expect(a).toEqual(b);
    expect(a.seed).toBe('B1-r1');
    expect(a.round).toBe(1);
    expect(a.sample).toHaveLength(28);
    expect(new Set(a.sample).size).toBe(28);
    expect(a.sample.every((x) => all.includes(x))).toBe(true);
    expect([...a.sample].sort()).toEqual(a.sample);
  });

  it('不同批次号 / 轮次 → 不同样本', () => {
    expect(drawSample('B1', all, []).sample).not.toEqual(drawSample('B2', all, []).sample);
    expect(fnv1a64('B1-r1|x')).not.toBe(fnv1a64('B1-r2|x'));
    expect(fnv1a64('')).toBe('cbf29ce484222325');
  });

  it('第二轮：必含上轮不通过条目，其余换成以往没抽过的', () => {
    const r1 = drawSample('B1', all, []);
    const failed = r1.sample.slice(0, 3);
    const prev: BatchRound[] = [{ ...r1, date: '2026-11-20', result: 'fail', failed }];
    const r2 = drawSample('B1', all, prev);
    expect(r2.round).toBe(2);
    expect(r2.seed).toBe('B1-r2');
    expect(r2.sample).toHaveLength(28);
    for (const f of failed) expect(r2.sample).toContain(f);
    const passedBefore = r1.sample.filter((x) => !failed.includes(x));
    expect(r2.sample.filter((x) => passedBefore.includes(x))).toEqual([]);
    expect(drawSample('B1', all, prev)).toEqual(r2);
  });

  it('新条目不够时从抽过的里补；不通过条目多于样本量时全部纳入', () => {
    const few = ids(8);
    const r1 = drawSample('B9', few, []);
    expect(r1.sample).toHaveLength(5);
    const r2 = drawSample('B9', few, [
      { ...r1, date: 'd', result: 'fail', failed: [r1.sample[0] as string] },
    ]);
    expect(r2.sample).toHaveLength(5);
    expect(r2.sample).toContain(r1.sample[0]);
    const many = r1.sample.concat(few.filter((x) => !r1.sample.includes(x))).slice(0, 7);
    const r3 = drawSample('B9', few, [{ ...r1, date: 'd', result: 'fail', failed: many }]);
    expect(r3.sample).toHaveLength(7);
  });

  it('上一轮未出结果或已通过时拒绝重抽；空批次报错', () => {
    const r1 = drawSample('B1', all, []);
    expect(() =>
      drawSample('B1', all, [{ ...r1, date: 'd', result: 'pending', failed: [] }]),
    ).toThrow(/尚未出结果/);
    expect(() => drawSample('B1', all, [{ ...r1, date: 'd', result: 'pass', failed: [] }])).toThrow(
      /已通过/,
    );
    expect(() => drawSample('B1', [], [])).toThrow(/没有条目/);
  });
});

describe('条目 status / reviewer 改写（真实素材文件）', () => {
  const src = read('ch01_daymaster.yaml');
  const before = parseTextsYaml('ch01_daymaster.yaml', src);
  const target = new Set(['CH1-DAYMASTER-JIA', 'CH1-DAYMASTER-WU']);

  it('approve：只改目标条目的两行，其余字节不变；重新解析后其他字段完全相同', () => {
    const { text, changed } = setEntryStatus(src, target, 'approved', '用户（B1、2026-11-20）');
    expect(changed.sort()).toEqual([...target].sort());
    expect(changedLines(src, text)).toHaveLength(4);
    const after = parseTextsYaml('ch01_daymaster.yaml', text);
    for (const [i, e] of after.entries()) {
      const b = before[i];
      if (target.has(e.id)) {
        expect(e.status).toBe('approved');
        expect(e.reviewer).toBe('用户（B1、2026-11-20）');
        expect({ ...e, status: b?.status, reviewer: b?.reviewer }).toEqual(b);
      } else {
        expect(e).toEqual(b);
      }
    }
  });

  it('reject（退回 draft、reviewer 清空）可逆：approve 再 reject 回到原文', () => {
    const a = setEntryStatus(src, target, 'approved', '用户（B1、2026-11-20）').text;
    const r = setEntryStatus(a, target, 'draft', null).text;
    expect(r).toBe(src);
  });

  it('不在文件里的 id 不影响；全部条目一起改', () => {
    const allIds = new Set(before.map((e) => e.id));
    const { text, changed } = setEntryStatus(
      src,
      new Set([...allIds, 'CH9-NOPE']),
      'reviewed',
      'mingli-expert',
    );
    expect(changed).toHaveLength(before.length);
    expect(parseTextsYaml('x', text).every((e) => e.status === 'reviewed')).toBe(true);
  });

  it('每个素材文件都能改写并保持可解析（12 个文件）', () => {
    for (const f of [
      'ch01_conclusion.yaml',
      'ch01_month.yaml',
      'ch01_strength.yaml',
      'ch02_adjust.yaml',
      'ch02_role.yaml',
      'ch02_yongshen.yaml',
      'ch06_career_wealth.yaml',
      'ch06_do_watch_rel.yaml',
      'ch06_head_1.yaml',
      'ch06_head_2.yaml',
      'ch06_love_health.yaml',
    ]) {
      const s = read(f);
      const es = parseTextsYaml(f, s);
      const { text, changed } = setEntryStatus(
        s,
        new Set(es.map((e) => e.id)),
        'approved',
        '用户（B1、2026-11-20）',
      );
      expect(changed, f).toHaveLength(es.length);
      expect(changedLines(s, text), f).toHaveLength(es.length * 2);
      expect(
        parseTextsYaml(f, text).every((e) => e.status === 'approved'),
        f,
      ).toBe(true);
    }
  });

  it('reviewer 中的引号与特殊字符按 YAML 双引号转义', () => {
    const { text } = setEntryStatus(
      src,
      new Set(['CH1-DAYMASTER-JIA']),
      'approved',
      '用户 "甲" # 备注',
    );
    expect(parseTextsYaml('x', text).find((e) => e.id === 'CH1-DAYMASTER-JIA')?.reviewer).toBe(
      '用户 "甲" # 备注',
    );
  });
});

describe('batches.yaml 改写（真实文件）', () => {
  const src = read('batches.yaml');
  const r1: BatchRound = {
    round: 1,
    seed: 'B1-r1',
    date: '2026-11-20',
    result: 'pending',
    sample: ['CH1-A', 'CH1-B'],
    failed: [],
  };

  it('rounds: [] → 块列表一行；只改这一处；解析后结构正确', () => {
    const t = upsertRound(src, 'B1', r1);
    expect(changedLines(src, t.replace(`\n${roundLine(r1)}`, ''))).toHaveLength(1);
    const b1 = (parse(t) as { batch: string; rounds: unknown[] }[])[0];
    expect(b1?.rounds).toEqual([
      {
        round: 1,
        seed: 'B1-r1',
        date: '2026-11-20',
        result: 'pending',
        sample: ['CH1-A', 'CH1-B'],
        failed: [],
      },
    ]);
  });

  it('同轮次替换、新轮次追加；行尾注释与其他字段不变', () => {
    let t = upsertRound(src, 'B1', r1);
    t = upsertRound(t, 'B1', { ...r1, result: 'fail', failed: ['CH1-A'] });
    t = upsertRound(t, 'B1', { ...r1, round: 2, seed: 'B1-r2', sample: ['CH1-A', 'CH1-C'] });
    const b1 = (parse(t) as Record<string, unknown>[])[0] as {
      rounds: BatchRound[];
      coverage: unknown;
    };
    expect(b1.rounds.map((r) => [r.round, r.result, r.failed])).toEqual([
      [1, 'fail', ['CH1-A']],
      [2, 'pending', []],
    ]);
    expect(b1.coverage).toEqual((parse(src) as Record<string, unknown>[])[0]?.coverage);
  });

  it('setBatchField：status / submitted 只改一行并保留行尾注释', () => {
    const t = setBatchField(src, 'B1', 'status', 'submitted');
    expect(changedLines(src, t)).toHaveLength(1);
    expect((parse(t) as { status: string }[])[0]?.status).toBe('submitted');
    const t2 = setBatchField(src, 'B1', 'submitted', '2026-11-20');
    expect((parse(t2) as { submitted: string }[])[0]?.submitted).toBe('2026-11-20');
    expect(() => setBatchField(src, 'B7', 'status', 'x')).toThrow(/没有批次 B7/);
  });
});
