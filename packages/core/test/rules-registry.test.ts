/**
 * T14：规则注册表 + 编号覆盖测试（ARCHITECTURE §4.2「规则与代码对应」）。
 *
 * - 扫描 rules/*.md 中的 CAL- / S- / Y- / SS- / R- 编号，与代码中的编号全集 RULE_IDS 双向相等；
 * - 每个编号恰好处于「已实现 / 待实现（负责任务）/ 仅文档（逐条原因）」之一；
 * - 待实现的负责任务必须在 docs/TASKS.md 中存在且未打勾（任务完成时忘了实现或登记 → 变红）；
 * - 仅文档编号只能是统称，covers 的细分编号必须真实存在且不是仅文档；
 * - 已实现的 CAL 编号用 cases.json 实跑 computeChart，确认每个编号都真的会被输出；
 * - 代码（core/src、apps/web、scripts）里出现的编号都必须在 rules/ 中存在；
 * - RuleHit：构造、格式化与 cases.json rules_hit_expected 的格式一致。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAL_RULE_IDS, computeChart } from '../src/index';
import {
  DOC_ONLY_RULES,
  PENDING_RULES,
  RULE_IDS,
  RULE_ID_PREFIX_FILES,
  RULE_IMPLEMENTATIONS,
  formatRuleHit,
  isRuleId,
  ruleHit,
  ruleIdPrefix,
  ruleStatus,
  type RuleId,
} from '../src/rules';
import { loadCases } from './helpers/cases';
import { RULES_DIR, readRulesFile } from './helpers/fixtures';
import { extractRuleIds, ruleIdsByFile } from './helpers/rules-md';

const REPO_ROOT = resolve(RULES_DIR, '..');
const REF = Date.parse('2026-10-30T00:00:00+08:00');

const byFile = ruleIdsByFile();
const mdIds = new Set([...byFile.values()].flatMap((s) => [...s]));
const ids = RULE_IDS as readonly string[];

describe('编号全集：rules/*.md ⇔ RULE_IDS', () => {
  it('rules/ 下确实扫到了 5 类编号（防止正则失效后空集合「通过」）', () => {
    for (const p of ['CAL-', 'S-', 'Y-', 'SS-', 'R-']) {
      expect(
        [...mdIds].some((id) => id.startsWith(p)),
        p,
      ).toBe(true);
    }
    expect(mdIds.size).toBeGreaterThanOrEqual(50);
  });

  it('md 中每个编号都已在 RULE_IDS 登记', () => {
    const missing = [...mdIds].filter((id) => !ids.includes(id));
    expect(missing, `md 中有、代码未登记：${missing.join('、')}`).toEqual([]);
  });

  it('RULE_IDS 中每个编号都在 md 中存在，且无重复', () => {
    const extra = ids.filter((id) => !mdIds.has(id));
    expect(extra, `代码登记了 md 里没有的编号：${extra.join('、')}`).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个编号都出现在其前缀对应的定义文件中（跨文件引用不能引用不存在的编号）', () => {
    for (const id of ids) {
      const prefix = ruleIdPrefix(id);
      expect(prefix, id).not.toBeNull();
      const file = RULE_ID_PREFIX_FILES[prefix as keyof typeof RULE_ID_PREFIX_FILES];
      expect(byFile.get(file)?.has(id), `${id} 未出现在 ${file}`).toBe(true);
    }
  });

  it('cases.json rules_hit_expected 引用的编号都在 RULE_IDS 中，且格式为「编号」或「编号:说明」', () => {
    let n = 0;
    for (const c of loadCases().cases) {
      const list = (c.expected as { rules_hit_expected?: readonly string[] }).rules_hit_expected;
      for (const s of list ?? []) {
        n++;
        const parts = s.split(':');
        expect(parts.length, `${c.id} ${s}`).toBeLessThanOrEqual(2);
        expect(isRuleId(parts[0] as string), `${c.id} ${s}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('注册表：每个编号恰好一种状态', () => {
  it('每个编号恰好处于 已实现 / 待实现 / 仅文档 之一', () => {
    const problems = RULE_IDS.flatMap((id) => {
      const n = [RULE_IMPLEMENTATIONS[id], PENDING_RULES[id], DOC_ONLY_RULES[id]].filter(
        Boolean,
      ).length;
      if (n === 0) return [`${id}：未实现，也不在待实现清单或仅文档白名单中`];
      if (n > 1) return [`${id}：同时登记在 ${n} 处（实现后须从待实现清单移除）`];
      return [];
    });
    expect(problems).toEqual([]);
    for (const id of RULE_IDS) expect(ruleStatus(id), id).not.toBeNull();
  });

  it('三张表的键都是 RULE_IDS 中的编号', () => {
    for (const table of [RULE_IMPLEMENTATIONS, PENDING_RULES, DOC_ONLY_RULES]) {
      for (const k of Object.keys(table)) expect(isRuleId(k), k).toBe(true);
    }
  });

  it('已实现编号都给出了实现模块与实现引用', () => {
    for (const [id, impl] of Object.entries(RULE_IMPLEMENTATIONS)) {
      expect(impl.module.length, id).toBeGreaterThan(0);
      expect(impl.impl, id).toBeTruthy();
    }
  });

  it('待实现编号的负责任务在 docs/TASKS.md 中存在且未打勾', () => {
    const tasks = readFileSync(join(REPO_ROOT, 'docs/TASKS.md'), 'utf8');
    const state = new Map<string, boolean>();
    for (const m of tasks.matchAll(/^- \[( |x)\] \*\*(T\d+) /gm)) {
      state.set(m[2] as string, m[1] === 'x');
    }
    expect(state.size).toBeGreaterThan(20);
    const problems = Object.entries(PENDING_RULES).flatMap(([id, p]) => {
      if (!state.has(p.task)) return [`${id}：负责任务 ${p.task} 在 TASKS.md 中不存在`];
      if (state.get(p.task)) {
        return [
          `${id}：负责任务 ${p.task} 已打勾，但编号仍在待实现清单（应实现并登记到 RULE_IMPLEMENTATIONS）`,
        ];
      }
      return p.note.length > 0 ? [] : [`${id}：缺少说明`];
    });
    expect(problems).toEqual([]);
  });

  it('仅文档编号：逐条有原因；只能是统称，covers 的细分编号存在且不是仅文档', () => {
    for (const [id, d] of Object.entries(DOC_ONLY_RULES)) {
      expect(d.reason.length, id).toBeGreaterThanOrEqual(30);
      expect(d.covers.length, id).toBeGreaterThan(0);
      for (const sub of d.covers) {
        expect(isRuleId(sub), `${id} → ${sub}`).toBe(true);
        expect(DOC_ONLY_RULES[sub], `${id} → ${sub} 不能也是仅文档`).toBeUndefined();
        expect(sub.startsWith(`${id}-`), `${id} → ${sub} 应是其细分编号`).toBe(true);
      }
      // 统称的细分编号要全部列出：以「统称-」开头的编号都应在 covers 里
      const children = RULE_IDS.filter((x) => x.startsWith(`${id}-`) && !d.covers.includes(x));
      expect(children, `${id} 漏列细分编号`).toEqual([]);
    }
  });

  it('打印编号统计（已实现 / 待实现 / 仅文档）', () => {
    const impl = RULE_IDS.filter((id) => RULE_IMPLEMENTATIONS[id]);
    const pending = RULE_IDS.filter((id) => PENDING_RULES[id]);
    const docOnly = RULE_IDS.filter((id) => DOC_ONLY_RULES[id]);
    const byTask = new Map<string, RuleId[]>();
    for (const id of pending) {
      const t = (PENDING_RULES[id] as { task: string }).task;
      byTask.set(t, [...(byTask.get(t) ?? []), id]);
    }
    console.info(
      [
        `[T14 规则编号] 共 ${RULE_IDS.length}：已实现 ${impl.length}、待实现 ${pending.length}、仅文档 ${docOnly.length}`,
        `  已实现：${impl.join('、')}`,
        ...[...byTask].map(([t, l]) => `  待实现 ${t}：${l.join('、')}`),
        `  仅文档：${docOnly.join('、')}`,
      ].join('\n'),
    );
    expect(impl.length + pending.length + docOnly.length).toBe(RULE_IDS.length);
  });
});

describe('已实现编号的运行时证据', () => {
  it('CAL_RULE_IDS 的每个编号都登记为已实现，且 cases.json 实跑时全部被 computeChart 输出过', () => {
    const seen = new Set<string>();
    for (const c of loadCases().cases) {
      for (const h of computeChart(c.input, REF).rules_hit) seen.add(h);
    }
    for (const id of CAL_RULE_IDS) {
      expect(RULE_IMPLEMENTATIONS[id], `${id} 未登记为已实现`).toBeDefined();
      expect(seen.has(id), `${id} 在 cases.json 实跑中从未出现`).toBe(true);
    }
  });

  it('登记为已实现的 CAL 编号必须真的在 CAL_RULE_IDS 中（删掉实现时变红）', () => {
    const cal = CAL_RULE_IDS as readonly string[];
    for (const id of Object.keys(RULE_IMPLEMENTATIONS)) {
      if (id.startsWith('CAL-')) expect(cal.includes(id), id).toBe(true);
    }
  });
});

describe('代码里的编号都在 rules/ 中存在', () => {
  const SCAN_DIRS = ['packages/core/src', 'apps/web/app', 'apps/web/server', 'scripts'];
  const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (EXT.test(e)) out.push(p);
    }
    return out;
  }

  it('扫描源代码文件，出现的编号均在 RULE_IDS 中', () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
    expect(files.length).toBeGreaterThan(10);
    const unknown: string[] = [];
    for (const f of files) {
      for (const id of extractRuleIds(readFileSync(f, 'utf8'))) {
        if (!ids.includes(id)) unknown.push(`${relative(REPO_ROOT, f)}：${id}`);
      }
    }
    expect(unknown, `代码中出现了 rules/ 不存在的编号`).toEqual([]);
  });

  it('编号正则自检：能识别多段编号与通配写法，不误识别相似串', () => {
    expect(extractRuleIds('见 Y-TH-NEUTRAL-OVERRIDE、Y-TH-*、S-COMBO:三合')).toEqual([
      'Y-TH-NEUTRAL-OVERRIDE',
      'Y-TH',
      'S-COMBO',
    ]);
    expect(extractRuleIds('CH1-CONCLUSION SHA-256 YYYY-MM-DD X-SS-1 utf-8 Y-1 年 S-0.6')).toEqual(
      [],
    );
    // 全角括号、中文紧邻时也能识别
    expect(extractRuleIds('（S-HIDE）规则S-LEVEL：')).toEqual(['S-HIDE', 'S-LEVEL']);
    expect(readRulesFile('strength.md')).toContain('S-HIDE');
  });
});

describe('RuleHit', () => {
  it('构造与格式化：无说明时只输出编号，有说明时「编号:说明」', () => {
    const a = ruleHit('S-COMBO', '三合寅午戌火+1.5', { combo: '寅午戌', bonus: 1.5 });
    expect(a).toEqual({
      ruleId: 'S-COMBO',
      text: '三合寅午戌火+1.5',
      evidence: { combo: '寅午戌', bonus: 1.5 },
    });
    expect(formatRuleHit(a)).toBe('S-COMBO:三合寅午戌火+1.5');
    expect(formatRuleHit(ruleHit('S-POWER'))).toBe('S-POWER');
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('拒绝未登记编号与含半角冒号的说明', () => {
    expect(() => ruleHit('S-NOPE' as RuleId)).toThrow();
    expect(() => ruleHit('S-LEVEL', '身旺:x')).toThrow();
  });
});
