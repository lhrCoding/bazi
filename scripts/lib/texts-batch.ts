/**
 * texts:batch 的实现（TASKS T26；rules/texts/README.md §9.1、ARCHITECTURE §4.3.8）。与命令行解析分开，便于测试。
 *
 * - sample <批次>：本批 lint 全过、条目全部为 reviewed → 按 drawSample 抽样 → batches.yaml 追加一轮（result: pending），
 *   批次 status = submitted（首次时写 submitted 日期）→ 生成抽检单 reports/texts-batch/<批次>-r<轮次>.md。
 * - approve <批次>：最近一轮必须 pending → 该轮 result = pass；本批全部条目 status = approved、
 *   reviewer = 「用户（批次号、日期）」；批次 status = approved。
 * - reject <批次> --fail id1,id2：最近一轮必须 pending，且不通过条目都在该轮样本中 → 该轮 result = fail、记下 failed；
 *   本批全部条目退回 draft、reviewer = null；批次 status = rejected。下一次 sample 必含这些条目、其余换样本。
 * 本批条目 = batches.yaml 中该批次 files 列出的文件里的全部条目。
 * 抽检单（T37 补全）：被抽条目全部变体 + 能触发它的 cases.json 案例与报告原段落 + 本批覆盖率表 + lint 结果。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  drawSample,
  setBatchField,
  setEntryStatus,
  upsertRound,
  type BatchRound,
} from '../../packages/core/src/texts/batch';
import type { TextEntry } from '../../packages/core/src/texts/schema';
import { parseTextsYaml } from '../../packages/core/src/texts/yaml';
import { chapterParas } from '../../packages/core/src/report/check';
import { computeCoverage } from '../../packages/core/src/texts/coverage';
import { buildCaseReports } from './case-reports';
import { loadAndLintTexts } from './texts-load';

export interface BatchOptions {
  textsDir: string;
  reportsDir: string;
  sectionsMd: string;
  /** YYYY-MM-DD */
  date: string;
  fail?: string[] | undefined;
  /** 仓库 rules/ 目录（抽检单的触发案例与覆盖率表要读 cases.json 等）；默认 textsDir 的上一级 */
  rulesDir?: string | undefined;
}

interface BatchInfo {
  batch: string;
  status: string;
  submitted: string | null;
  files: string[];
  rounds: BatchRound[];
}

function readBatch(textsDir: string, batch: string): BatchInfo {
  const all = parse(readFileSync(join(textsDir, 'batches.yaml'), 'utf8')) as BatchInfo[] | null;
  const b = (all ?? []).find((x) => x.batch === batch);
  if (!b) throw new Error(`batches.yaml 中没有批次 ${batch}`);
  return { ...b, rounds: (b.rounds ?? []).map((r) => ({ ...r, failed: r.failed ?? [] })) };
}

function writeBatchYaml(textsDir: string, edit: (s: string) => string): void {
  const p = join(textsDir, 'batches.yaml');
  const next = edit(readFileSync(p, 'utf8'));
  parse(next); // 改写后必须仍是合法 YAML
  writeFileSync(p, next);
}

/** 改写本批文件中全部条目的 status / reviewer，改完重新解析校验 */
function setAllStatus(
  textsDir: string,
  files: readonly string[],
  ids: ReadonlySet<string>,
  status: 'draft' | 'approved',
  reviewer: string | null,
): number {
  let n = 0;
  for (const f of files) {
    const p = join(textsDir, f);
    const { text, changed } = setEntryStatus(readFileSync(p, 'utf8'), ids, status, reviewer);
    const check = parseTextsYaml(f, text);
    if (check.some((e) => ids.has(e.id) && (e.status !== status || e.reviewer !== reviewer))) {
      throw new Error(`${f} 改写后校验失败`);
    }
    writeFileSync(p, text);
    n += changed.length;
  }
  return n;
}

interface SheetExtra {
  /** 条目 id → 命中它的 cases.json 案例与报告中的原段落 */
  triggers: Map<string, { caseId: string; title: string; text: string }[]>;
  coverage: { slot: string; combos: number; covered: number }[];
  lintNote: string;
}

/** 抽检单附加信息：用全部素材为 cases.json 每个案例拼装报告，记下每条素材被哪些案例选中；本批槽位覆盖率 */
function sheetExtra(
  rulesDir: string,
  all: readonly TextEntry[],
  batchEntries: readonly TextEntry[],
): SheetExtra {
  const reports = buildCaseReports(rulesDir, all, ['draft', 'reviewed', 'approved']);
  const triggers = new Map<string, { caseId: string; title: string; text: string }[]>();
  for (const r of reports) {
    for (const ch of r.report.chapters) {
      for (const p of chapterParas(ch.blocks)) {
        if (!p.entry) continue;
        const list = triggers.get(p.entry) ?? [];
        if (!list.some((x) => x.caseId === r.id))
          list.push({ caseId: r.id, title: r.title, text: p.text });
        triggers.set(p.entry, list);
      }
    }
  }
  const base = reports.find((r) => r.id === 'C16')?.ctx ?? reports[0]?.ctx;
  const slots = new Set(batchEntries.map((e) => e.slot));
  const cov = computeCoverage(batchEntries, (base ?? {}) as never, [
    'draft',
    'reviewed',
    'approved',
  ]);
  return {
    triggers,
    coverage: cov.slots.filter((s) => slots.has(s.slot)),
    lintNote: `${all.length} 条素材`,
  };
}

function sheet(
  batch: string,
  r: BatchRound,
  entries: readonly TextEntry[],
  fileOf: Map<string, string>,
  extra: SheetExtra,
): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = [
    `# 素材抽检单 ${batch} 第 ${r.round} 轮`,
    '',
    `- 种子：\`${r.seed}\`（可复现：同一种子抽样结果永远相同）`,
    `- 日期：${r.date}`,
    `- 本批条目：${entries.length} 条；抽检 ${r.sample.length} 条（10% 向上取整、至少 5 条）`,
    `- 自动检查：L1–L12 全部通过（${extra.lintNote}）`,
    '',
    '### 本批覆盖率（静态穷举，修饰字段取默认值）',
    '',
    '| 槽位 | 组合 | 已覆盖 |',
    '|---|---|---|',
    ...extra.coverage.map(
      (c) =>
        `| ${c.slot} | ${c.combos} | ${c.covered}${c.covered === c.combos ? '' : '（有缺口）'} |`,
    ),
    '',
    '请逐条给出「通过 / 不通过 + 意见」。全部通过 → `npm run texts:batch -- approve ' +
      batch +
      '`；有不通过 → `npm run texts:batch -- reject ' +
      batch +
      ' --fail 条目id,…`。',
    '',
  ];
  r.sample.forEach((id, i) => {
    const e = byId.get(id);
    if (!e) return;
    out.push(`## ${i + 1}. ${e.id}`, '');
    out.push(
      `- 槽位：${e.slot}\u3000文件：${fileOf.get(id) ?? ''}\u3000优先级：${e.priority}${e.fallback ? '（兜底）' : ''}`,
    );
    out.push(`- 触发条件：\`${JSON.stringify(e.when)}\``);
    if (e.asserts.length) out.push(`- 正文断言：\`${JSON.stringify(e.asserts)}\``);
    out.push(`- 字数区间：${e.length[0]}–${e.length[1]}${e.requires_hour ? '；需要时辰' : ''}`);
    out.push('');
    e.variants.forEach((v, j) => out.push(`**变体 ${j + 1}**：${v}`, ''));
    if (e.quote)
      out.push(
        `> ${e.quote.text} ——${e.quote.source}（已核对：${e.quote.verified ? '是' : '否'}）`,
        '',
      );
    if (e.notes) out.push(`作者说明：${e.notes}`, '');
    const hits = extra.triggers.get(id) ?? [];
    if (hits.length === 0) {
      out.push(
        '能触发它的案例：cases.json 中没有案例命中（可在 `npm run texts:preview` 之外另找命盘核对）',
        '',
      );
    } else {
      out.push(
        `能触发它的案例（cases.json，共 ${hits.length} 个，列前 ${Math.min(3, hits.length)} 个）：`,
        '',
      );
      for (const h of hits.slice(0, 3)) out.push(`- **${h.caseId}** ${h.title}：${h.text}`);
      out.push('');
    }
    out.push('结论：☐ 通过　☐ 不通过　意见：', '');
  });
  return out.join('\n');
}

export function runBatch(cmd: string, batch: string, opts: BatchOptions): string[] {
  const log: string[] = [];
  const info = readBatch(opts.textsDir, batch);
  const loaded = loadAndLintTexts(opts.textsDir, opts.sectionsMd);
  const fileSet = new Set(info.files);
  const entries = loaded.entries.filter((e) => fileSet.has(loaded.fileOf.get(e.id) ?? ''));
  const ids = new Set(entries.map((e) => e.id));
  const last = info.rounds.at(-1);

  if (cmd === 'sample') {
    const issues = loaded.problems.filter((p) => {
      const id = p.split('\t')[0] as string;
      return ids.has(id) || info.files.some((f) => id === `(${f})`);
    });
    if (issues.length > 0)
      throw new Error(`本批有 ${issues.length} 个 lint 问题，修复后再抽样：\n${issues.join('\n')}`);
    const notReviewed = entries.filter((e) => e.status !== 'reviewed');
    if (notReviewed.length > 0) {
      throw new Error(
        `本批有 ${notReviewed.length} 条不是 reviewed（README §9.1 第 3 步自审后才能抽检），如 ${notReviewed
          .slice(0, 3)
          .map((e) => `${e.id}=${e.status}`)
          .join('、')}`,
      );
    }
    const s = drawSample(batch, [...ids], info.rounds);
    const r: BatchRound = { ...s, date: opts.date, result: 'pending', failed: [] };
    writeBatchYaml(opts.textsDir, (t) => {
      let x = upsertRound(t, batch, r);
      x = setBatchField(x, batch, 'status', 'submitted');
      if (info.submitted === null) x = setBatchField(x, batch, 'submitted', opts.date);
      return x;
    });
    const dir = join(opts.reportsDir, 'texts-batch');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${batch}-r${r.round}.md`);
    writeFileSync(
      p,
      sheet(
        batch,
        r,
        entries,
        loaded.fileOf,
        sheetExtra(opts.rulesDir ?? join(opts.textsDir, '..'), loaded.entries, entries),
      ),
    );
    log.push(
      `${batch} 第 ${r.round} 轮抽样（种子 ${r.seed}）：${r.sample.length} / ${ids.size} 条`,
      `抽检单：${p}`,
    );
    return log;
  }

  if (cmd === 'approve' || cmd === 'reject') {
    if (!last || last.result !== 'pending')
      throw new Error(`${batch} 没有待出结果的抽检轮次（先 sample）`);
    if (cmd === 'approve') {
      const reviewer = `用户（${batch}、${opts.date}）`;
      const n = setAllStatus(opts.textsDir, info.files, ids, 'approved', reviewer);
      writeBatchYaml(opts.textsDir, (t) =>
        setBatchField(
          upsertRound(t, batch, { ...last, result: 'pass', date: opts.date }),
          batch,
          'status',
          'approved',
        ),
      );
      log.push(`${batch} 第 ${last.round} 轮通过：${n} 条改为 approved，reviewer = ${reviewer}`);
      return log;
    }
    const fail = opts.fail ?? [];
    if (fail.length === 0) throw new Error('reject 需要 --fail 列出不通过的条目');
    const notInSample = fail.filter((id) => !last.sample.includes(id));
    if (notInSample.length > 0)
      throw new Error(`不通过条目不在第 ${last.round} 轮样本中：${notInSample.join('、')}`);
    const n = setAllStatus(opts.textsDir, info.files, ids, 'draft', null);
    writeBatchYaml(opts.textsDir, (t) =>
      setBatchField(
        upsertRound(t, batch, {
          ...last,
          result: 'fail',
          failed: [...fail].sort(),
          date: opts.date,
        }),
        batch,
        'status',
        'rejected',
      ),
    );
    log.push(
      `${batch} 第 ${last.round} 轮不通过（${fail.join('、')}）：整批 ${n} 条退回 draft；下一轮将必含这些条目`,
    );
    return log;
  }
  throw new Error(`未知命令 ${cmd}（sample / approve / reject）`);
}
