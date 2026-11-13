/**
 * T26 texts:batch 全流程（临时目录中的 rules/texts 副本）：sample → reject → 重抽 → approve。
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { runBatch } from '../../../scripts/lib/texts-batch';
import { setEntryStatus } from '../src/texts/batch';
import { parseTextsYaml } from '../src/texts/yaml';
import { readRulesFile } from './helpers/fixtures';

const SRC = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'texts-batch-'));
const texts = join(tmp, 'texts');
const reports = join(tmp, 'reports');
cpSync(SRC, texts, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sectionsMd = readRulesFile('report-sections.md');
const RULES = fileURLToPath(new URL('../../../rules/', import.meta.url));
const opts = (date: string, fail?: string[]) => ({
  textsDir: texts,
  reportsDir: reports,
  sectionsMd,
  date,
  fail,
  rulesDir: RULES,
});
const files =
  (parse(readFileSync(join(texts, 'batches.yaml'), 'utf8')) as { files: string[] }[])[0]?.files ??
  [];
const statuses = (): { id: string; status: string; reviewer: string | null }[] =>
  files.flatMap((f) => parseTextsYaml(f, readFileSync(join(texts, f), 'utf8')));
const batchInfo = () =>
  (parse(readFileSync(join(texts, 'batches.yaml'), 'utf8')) as Record<string, unknown>[])[0] as {
    status: string;
    submitted: string | null;
    rounds: { round: number; result: string; sample: string[]; failed: string[] }[];
  };

// 每步都会对整个素材库跑 lint，素材随批次增加而变慢，放宽超时
describe('texts:batch 全流程', { timeout: 30_000 }, () => {
  it('draft 状态拒绝抽样，且不改任何文件', () => {
    const before = readFileSync(join(texts, 'batches.yaml'), 'utf8');
    expect(() => runBatch('sample', 'B1', opts('2026-11-20'))).toThrow(/不是 reviewed/);
    expect(readFileSync(join(texts, 'batches.yaml'), 'utf8')).toBe(before);
  });

  it('自审后（reviewed）→ sample：写入第 1 轮、批次 submitted、生成抽检单', () => {
    for (const f of files) {
      const p = join(texts, f);
      const s = readFileSync(p, 'utf8');
      const ids = new Set(parseTextsYaml(f, s).map((e) => e.id));
      writeFileSync(p, setEntryStatus(s, ids, 'reviewed', 'mingli-expert').text);
    }
    const out = runBatch('sample', 'B1', opts('2026-11-20'));
    expect(out[0]).toContain('28 / 274');
    const b = batchInfo();
    expect(b.status).toBe('submitted');
    expect(b.submitted).toBe('2026-11-20');
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0]?.result).toBe('pending');
    const sheet = readFileSync(join(reports, 'texts-batch', 'B1-r1.md'), 'utf8');
    for (const id of b.rounds[0]?.sample ?? []) expect(sheet).toContain(`. ${id}`);
    expect(sheet).toContain('种子：`B1-r1`');
    // T37：本批覆盖率表、触发案例与原段落
    expect(sheet).toContain('| CH1-DAYMASTER | 10 | 10 |');
    expect(sheet).toMatch(/能触发它的案例（cases\.json，共 \d+ 个/);
    expect(sheet).toMatch(/- \*\*C\d\d\*\* /);
  });

  it('未出结果时不能重抽', () => {
    expect(() => runBatch('sample', 'B1', opts('2026-11-21'))).toThrow(/尚未出结果/);
  });

  it('reject：不通过条目必须在样本中；整批退回 draft；第 1 轮记 fail', () => {
    expect(() => runBatch('reject', 'B1', opts('2026-11-21'))).toThrow(/--fail/);
    expect(() => runBatch('reject', 'B1', opts('2026-11-21', ['CH9-NOPE']))).toThrow(
      /不在第 1 轮样本/,
    );
    const failed = batchInfo().rounds[0]?.sample.slice(0, 2) ?? [];
    runBatch('reject', 'B1', opts('2026-11-21', failed));
    expect(statuses().every((e) => e.status === 'draft' && e.reviewer === null)).toBe(true);
    const b = batchInfo();
    expect(b.status).toBe('rejected');
    expect(b.rounds[0]).toMatchObject({ result: 'fail', failed: [...failed].sort() });
  });

  it('修改后再自审 → 第 2 轮：必含上轮不通过条目，submitted 日期不变', () => {
    for (const f of files) {
      const p = join(texts, f);
      const s = readFileSync(p, 'utf8');
      writeFileSync(
        p,
        setEntryStatus(
          s,
          new Set(parseTextsYaml(f, s).map((e) => e.id)),
          'reviewed',
          'mingli-expert',
        ).text,
      );
    }
    runBatch('sample', 'B1', opts('2026-11-25'));
    const b = batchInfo();
    expect(b.rounds).toHaveLength(2);
    for (const id of b.rounds[0]?.failed ?? []) expect(b.rounds[1]?.sample).toContain(id);
    expect(b.submitted).toBe('2026-11-20');
    expect(existsSync(join(reports, 'texts-batch', 'B1-r2.md'))).toBe(true);
  });

  it('approve：整批 approved、reviewer = 用户（批次号、日期）；第 2 轮 pass', () => {
    runBatch('approve', 'B1', opts('2026-11-26'));
    expect(
      statuses().every((e) => e.status === 'approved' && e.reviewer === '用户（B1、2026-11-26）'),
    ).toBe(true);
    const b = batchInfo();
    expect(b.status).toBe('approved');
    expect(b.rounds.map((r) => r.result)).toEqual(['fail', 'pass']);
    expect(() => runBatch('approve', 'B1', opts('2026-11-27'))).toThrow(/没有待出结果/);
    expect(() => runBatch('sample', 'B1', opts('2026-11-27'))).toThrow();
  });

  it('全流程后素材正文与其他字段不变（只有 status / reviewer 不同）', () => {
    for (const f of files) {
      const a = readFileSync(join(SRC, f), 'utf8').split('\n');
      const b = readFileSync(join(texts, f), 'utf8').split('\n');
      expect(b.length, f).toBe(a.length);
      const diff = a.flatMap((l, i) => (l === b[i] ? [] : [l]));
      expect(
        diff.every((l) => /^ {2}(status|reviewer): /.test(l)),
        f,
      ).toBe(true);
    }
  });

  it('未知命令 / 未知批次报错', () => {
    expect(() => runBatch('publish', 'B1', opts('2026-11-27'))).toThrow(/未知命令/);
    expect(() => runBatch('sample', 'B7', opts('2026-11-27'))).toThrow(/没有批次 B7/);
  });
});
