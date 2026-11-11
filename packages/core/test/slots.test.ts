/**
 * T22 槽位注册表 ⇔ report-sections.md §3（R-SLOT）。
 * 验收：md 表格与 slots.ts 比对测试通过，故意改一个槽位 id 时变红。
 */
import { describe, expect, it } from 'vitest';
import { SLOTS, type SlotDef } from '../src/report/slots';
import { fieldSpec } from '../src/texts/fields';
import { readRulesFile } from './helpers/fixtures';

interface MdSlot {
  id: string;
  chapter: number;
  name: string;
  required: boolean;
  dimension: string;
  pick: string;
  lengthText: string | null;
  basis: string | null;
  polish: boolean;
  nohour: string;
}

/** 解析 §3 各章表格中以 `| CH` 开头的行；一行列多个槽位时展开（`CH2-ROLE-YONG / -XI / -JI`）。 */
function parseMdSlots(md: string): MdSlot[] {
  const sec = md.slice(md.indexOf('## 3. 槽位定义'), md.indexOf('## 4. 不知道时辰'));
  const out: MdSlot[] = [];
  for (const block of sec.split('\n### ').slice(1)) {
    const m = /^第 (\d) 章/.exec(block);
    if (!m) continue;
    const lines = block.split('\n');
    const header = lines.find((l) => l.startsWith('| 槽位'));
    if (!header) continue;
    const cols = header
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    for (const line of lines.filter((l) => l.startsWith('| CH'))) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const d = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
      const head =
        /^((?:CH\d-[A-Z0-9-]+|-[A-Z0-9]+)(?: \/ (?:CH\d-[A-Z0-9-]+|-[A-Z0-9]+))*) (.+)$/.exec(
          d['槽位'] ?? '',
        );
      if (!head) throw new Error(`无法解析槽位单元格：${d['槽位']}`);
      const parts = (head[1] as string).split('/').map((p) => p.trim());
      const base = parts[0] as string;
      for (const p of parts) {
        out.push({
          id: p.startsWith('-') ? base.slice(0, base.lastIndexOf('-')) + p : p,
          chapter: Number(m[1]),
          name: head[2] as string,
          required: d['必需'] === 'Y',
          dimension: d['维度'] ?? '',
          pick: d['选几条'] ?? '',
          lengthText: d['每条字数'] ?? null,
          basis: '依据模板' in d ? (d['依据模板'] as string) : null,
          polish: d['润色'] === '可',
          nohour: d['无时辰'] ?? '',
        });
      }
    }
  }
  return out;
}

/** 注册表与 md 的差异（空 = 一致） */
function diffSlots(md: readonly MdSlot[], reg: readonly SlotDef[]): string[] {
  const problems: string[] = [];
  const mdIds = md.map((s) => s.id);
  const regIds = reg.map((s) => s.id);
  if (JSON.stringify(mdIds) !== JSON.stringify(regIds)) {
    problems.push(
      `槽位 id 或顺序不一致：md 独有 ${JSON.stringify(mdIds.filter((x) => !regIds.includes(x)))}，` +
        `代码独有 ${JSON.stringify(regIds.filter((x) => !mdIds.includes(x)))}`,
    );
  }
  for (const m of md) {
    const r = reg.find((x) => x.id === m.id);
    if (!r) continue;
    for (const k of [
      'chapter',
      'name',
      'required',
      'dimension',
      'pick',
      'lengthText',
      'basis',
      'polish',
      'nohour',
    ] as const) {
      if (m[k] !== r[k])
        problems.push(`${m.id}.${k}：md ${JSON.stringify(m[k])}，代码 ${JSON.stringify(r[k])}`);
    }
  }
  return problems;
}

const md = readRulesFile('report-sections.md');
const MD_SLOTS = parseMdSlots(md);

describe('slots.ts ⇔ report-sections.md §3', () => {
  it('md 解析出 45 个槽位，覆盖第 1–7 章', () => {
    expect(MD_SLOTS).toHaveLength(45);
    expect([...new Set(MD_SLOTS.map((s) => s.chapter))]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('逐槽位逐字段一致（id、顺序、名称、必需、维度、选几条、字数、依据模板、润色、无时辰）', () => {
    expect(diffSlots(MD_SLOTS, SLOTS)).toEqual([]);
  });

  it('故意改一个槽位 id → 比对变红', () => {
    const broken = SLOTS.map((s) => (s.id === 'CH2-METHOD' ? { ...s, id: 'CH2-METHODS' } : s));
    const d = diffSlots(MD_SLOTS, broken);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]).toContain('CH2-METHODS');
  });

  it('故意改字数 / 必需 → 比对变红', () => {
    const a = SLOTS.map((s) => (s.id === 'CH1-MONTH' ? { ...s, lengthText: '100–160' } : s));
    expect(diffSlots(MD_SLOTS, a)).toEqual(['CH1-MONTH.lengthText：md "100–150"，代码 "100–160"']);
    const b = SLOTS.map((s) => (s.id === 'CH2-SWAP' ? { ...s, required: true } : s));
    expect(diffSlots(MD_SLOTS, b)).toHaveLength(1);
  });

  it('length 与 lengthText 一致', () => {
    for (const s of SLOTS) {
      const m = /^(\d+)–(\d+)$/.exec(s.lengthText ?? '');
      expect(s.length, s.id).toEqual(m ? [Number(m[1]), Number(m[2])] : null);
    }
  });
});

describe('结构化字段', () => {
  it('维度 / 修饰字段都在字段字典里', () => {
    for (const s of SLOTS) {
      for (const f of [...(s.dimensionFields ?? []), ...s.modifierFields]) {
        expect(fieldSpec(f), `${s.id} 引用 ${f}`).toBeDefined();
      }
    }
  });

  it('修饰字段 = md「修饰：」后列出的字段', () => {
    for (const s of SLOTS) {
      const m = /修饰：([^；|]+)/.exec(s.dimension);
      const mdMods = m ? (m[1] as string).split('、').map((x) => x.trim()) : [];
      expect([...s.modifierFields], s.id).toEqual(mdMods);
    }
  });

  it('md 维度原文中出现的字典字段都属于 dimensionFields ∪ modifierFields（有结构化字段的槽位）', () => {
    for (const s of SLOTS.filter((x) => x.dimensionFields !== null)) {
      const mentioned = [...s.dimension.matchAll(/[a-z_]+\.[A-Za-z0-9_一-龥]+/g)]
        .map((x) => x[0])
        .filter((f) => fieldSpec(f) !== undefined);
      const allowed = new Set([...(s.dimensionFields ?? []), ...s.modifierFields]);
      for (const f of mentioned) expect(allowed.has(f), `${s.id} 维度提到 ${f}`).toBe(true);
    }
  });

  it('必需的素材槽位要么有维度字段，要么写明缺口', () => {
    for (const s of SLOTS.filter((x) => x.required && x.source === 'material')) {
      expect(s.dimensionFields !== null || s.gap !== undefined, s.id).toBe(true);
    }
  });

  it('代码模板槽位的维度原文写明「代码」；固定文本写明「固定文本」', () => {
    for (const s of SLOTS) {
      if (s.source === 'code') expect(s.dimension, s.id).toMatch(/代码/);
      if (s.source === 'fixed') expect(s.dimension, s.id).toMatch(/固定文本/);
    }
  });

  it('循环槽位：素材条件只引用 item.* 或不限制', () => {
    for (const s of SLOTS.filter((x) => x.loop && x.dimensionFields !== null)) {
      for (const f of s.dimensionFields ?? [])
        expect(f.startsWith('item.'), `${s.id} ${f}`).toBe(true);
    }
  });
});
