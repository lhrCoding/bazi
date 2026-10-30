/**
 * T14：参数漂移测试 + rulesVersion。
 *
 * - rules/*.md 中的每个 ```json 代码块都必须在下面的 JSON_BLOCKS 中归类：
 *   「参数」块与代码常量逐项比对；「示例」块写明由哪个任务按结构比对。新增代码块而未归类 → 失败。
 * - strength.md §1.2 S-HIDE ⇔ HIDDEN_STEMS（T13 的同名比对已移到这里统一维护）；§2.1 位置权重 ⇔ POSITION_WEIGHTS。
 * - RULES_VERSION = rules/ 规则文件内容 SHA-256 前 8 位（算法见 src/rules/version.ts）。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HIDDEN_STEMS, POSITION_WEIGHTS, RULES_FILES, RULES_VERSION } from '../src/rules';
import { readRulesFile } from './helpers/fixtures';
import { extractJsonBlocks, listRulesMarkdown, type JsonBlock } from './helpers/rules-md';

type BlockKind =
  { kind: 'param'; check: (value: unknown) => void } | { kind: 'example'; comparedBy: string };

/** 文件 → 按出现顺序的 json 块：所在标题 + 归类。 */
const JSON_BLOCKS: Readonly<Record<string, readonly { heading: string; spec: BlockKind }[]>> = {
  'strength.md': [
    { heading: '1.2 地支藏干与比例（S-HIDE）', spec: { kind: 'param', check: checkHide } },
    { heading: '2.1 位置权重', spec: { kind: 'param', check: checkWeights } },
    {
      heading: '7. 输出结构（JSON）',
      spec: { kind: 'example', comparedBy: 'T15–T18（C11 输出结构）' },
    },
  ],
  'yongshen.md': [
    { heading: '6. 闲神与输出', spec: { kind: 'example', comparedBy: 'T17（C16 输出结构）' } },
  ],
  'shensha.md': [
    { heading: '2. 计算与输出（SS-OUTPUT）', spec: { kind: 'example', comparedBy: 'T19' } },
  ],
  'report-sections.md': [
    {
      heading: '0. 拼装上下文 ctx（R-CTX）',
      spec: { kind: 'example', comparedBy: 'T27（C16 ctx）' },
    },
  ],
};

function checkHide(value: unknown): void {
  const fromMd = value as Record<string, [string, number][]>;
  expect(Object.keys(fromMd).sort()).toEqual(Object.keys(HIDDEN_STEMS).sort());
  for (const [zhi, list] of Object.entries(HIDDEN_STEMS)) {
    // 顺序（本气在前）、藏干、比例逐项相等
    expect(
      list.map(([g, r]) => [g, r]),
      zhi,
    ).toEqual(fromMd[zhi]);
    expect(
      list.reduce((s, [, r]) => s + r, 0),
      zhi,
    ).toBeCloseTo(1, 10);
  }
}

function checkWeights(value: unknown): void {
  expect(value).toEqual(POSITION_WEIGHTS);
}

const allBlocks: JsonBlock[] = listRulesMarkdown().flatMap((f) => extractJsonBlocks(f));

describe('rules/*.md 的 JSON 代码块全部归类', () => {
  it('每个文件的 json 块个数、所在标题与登记一致', () => {
    const actual = new Map<string, string[]>();
    for (const b of allBlocks) actual.set(b.file, [...(actual.get(b.file) ?? []), b.heading]);
    const expected = new Map(
      Object.entries(JSON_BLOCKS).map(([f, l]) => [f, l.map((x) => x.heading)]),
    );
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  for (const [file, specs] of Object.entries(JSON_BLOCKS)) {
    specs.forEach(({ heading, spec }, i) => {
      if (spec.kind === 'param') {
        it(`参数块 ${file} §${heading} 与代码常量一致`, () => {
          const block = allBlocks.filter((b) => b.file === file)[i];
          expect(block?.heading).toBe(heading);
          spec.check(block?.value);
        });
      } else {
        it(`示例块 ${file} §${heading}：可解析，结构比对由 ${spec.comparedBy} 负责`, () => {
          const block = allBlocks.filter((b) => b.file === file)[i];
          expect(block?.heading).toBe(heading);
          expect(typeof block?.value).toBe('object');
        });
      }
    });
  }
});

describe('strength.md 正文中的权重合计与参数块一致', () => {
  it('四柱总权重 9.1、三柱 7.1（日干不计）', () => {
    const md = readRulesFile('strength.md');
    const m = /四柱总权重 = [^=]+= ([\d.]+)；三柱（无时辰）= ([\d.]+)/.exec(md);
    expect(m).not.toBeNull();
    const [four, three] = [Number(m?.[1]), Number(m?.[2])];
    const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
    const total = sum(POSITION_WEIGHTS.stem) + sum(POSITION_WEIGHTS.branch);
    expect(total).toBeCloseTo(four, 10);
    expect(total - POSITION_WEIGHTS.stem.hour - POSITION_WEIGHTS.branch.hour).toBeCloseTo(
      three,
      10,
    );
    expect(POSITION_WEIGHTS.stem.day).toBe(0);
  });
});

describe('rulesVersion', () => {
  function computeRulesVersion(files: readonly string[]): string {
    const h = createHash('sha256');
    for (const f of [...files].sort()) {
      h.update(f, 'utf8');
      h.update('\0', 'utf8');
      h.update(readRulesFile(f).replace(/\r\n/g, '\n'), 'utf8');
      h.update('\0', 'utf8');
    }
    return h.digest('hex').slice(0, 8);
  }

  it('RULES_FILES = rules/ 下除 README.md 外的全部 .md', () => {
    expect([...RULES_FILES]).toEqual(listRulesMarkdown().filter((f) => f !== 'README.md'));
  });

  it('RULES_VERSION 与 rules/ 规则文件内容的 SHA-256 前 8 位一致', () => {
    const actual = computeRulesVersion(RULES_FILES);
    expect(
      RULES_VERSION,
      `rules/ 规则文件已变化：按 rules/README.md 重跑 cases.json 并记录结论变化后，把 src/rules/version.ts 的 RULES_VERSION 改为 '${actual}'`,
    ).toBe(actual);
  });

  it('格式为 8 位小写十六进制', () => {
    expect(RULES_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});
