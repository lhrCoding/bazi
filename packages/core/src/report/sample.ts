/**
 * 动态覆盖率与字数分布（TASKS T35；rules/report-sections.md §5.1 第 3 条、texts/README.md §4.2）。
 *
 * 对一批出生信息逐个跑完整拼装（排盘 → 规则 → ctx → assembleReport → R-CHECK），统计四项指标：
 *   1. 必需槽位兜底命中数（fallback_used）与素材缺口（slot_empty），目标 0；
 *   2. 全文字数落在 §2 范围内的比例，目标 ≥ 99%；
 *   3. R-CHECK 各规则不通过的报告数，目标 0；
 *   4. 素材缺陷：某次选段时 when 成立而 asserts 不成立（作者写了触发条件保证不了的事），目标 0。
 * 另给出逐章字数，供 QA_REPORT 的标准案例字数分布表。
 * 随机出生信息由固定种子生成（mulberry32），同一种子结果永远相同。纯函数，不读文件。
 */
import { computeChart } from '../bazi/chart';
import type { BirthInput } from '../bazi/types';
import { analyze } from '../rules/analyze';
import { evaluateCondition, type EvalContext } from '../texts/condition';
import type { Wordlists } from '../texts/lint';
import { assembleReport } from './assemble';
import { chapterParas, rcheck, textLength, type RCheckRule } from './check';
import { buildCtx } from './ctx';
import type { GlossaryTerm } from './render';
import type { TextLibrary } from './select';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * 随机出生信息：公历 fromYear-01-01 至 toYear-12-31 均匀取日，男女各半（交替），noHourRate 比例无时辰，
 * 时刻按分钟均匀；不选出生地；交节日无时辰时选「不确定」。
 */
export function randomBirthInputs(
  n: number,
  seed: number,
  opts: { fromYear?: number; toYear?: number; noHourRate?: number } = {},
): BirthInput[] {
  const { fromYear = 1940, toYear = 2030, noHourRate = 0.1 } = opts;
  const r = mulberry32(seed);
  const start = Date.UTC(fromYear, 0, 1);
  const days = Math.round((Date.UTC(toYear, 11, 31) - start) / 86400000) + 1;
  const out: BirthInput[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start + Math.floor(r() * days) * 86400000);
    const noHour = r() < noHourRate;
    const minute = Math.floor(r() * 1440);
    out.push({
      calendar: 'solar',
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: noHour ? null : `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`,
      gender: i % 2 === 0 ? '男' : '女',
      placeCode: null,
      jieqiChoice: null,
    });
  }
  return out;
}

export interface SampleOptions {
  library: TextLibrary;
  glossary: readonly GlossaryTerm[];
  words: Wordlists;
  limitations: readonly string[];
  textsVersion: string;
  refDateMs: number;
}

export interface AssertDefect {
  entry: string;
  slot: string;
  /** 触发该缺陷的第一个样本序号 */
  firstSample: number;
  count: number;
}

export interface SampleMetrics {
  samples: number;
  /** 排盘报错的输入数（如夏令时跳变不存在的时刻），不计入其余指标 */
  invalidInputs: number;
  fallbackUsed: Record<string, number>;
  slotEmpty: Record<string, number>;
  /** 有兜底或空槽的报告数 */
  reportsWithFallback: number;
  lengthPass: number;
  lengthPassRate: number;
  rcheckFailedReports: Partial<Record<RCheckRule, number>>;
  assertDefects: AssertDefect[];
  /** 每份报告逐章字数（第 1–7 章）与全文；只在 keepLengths 时返回 */
  lengths?: { chapters: Record<number, number>; total: number }[];
}

const TOTAL: readonly [number, number] = [5000, 8000];
const TOTAL_NOHOUR_MIN = 4800;

export function runSample(
  inputs: readonly BirthInput[],
  o: SampleOptions,
  keepLengths = false,
): SampleMetrics {
  const m: SampleMetrics = {
    samples: inputs.length,
    invalidInputs: 0,
    fallbackUsed: {},
    slotEmpty: {},
    reportsWithFallback: 0,
    lengthPass: 0,
    lengthPassRate: 0,
    rcheckFailedReports: {},
    assertDefects: [],
    ...(keepLengths ? { lengths: [] } : {}),
  };
  const defects = new Map<string, AssertDefect>();
  const bySlot = o.library.bySlot;
  inputs.forEach((input, idx) => {
    let chart;
    try {
      chart = computeChart(input, o.refDateMs);
    } catch {
      m.invalidInputs++;
      return;
    }
    const analysis = analyze(chart);
    const ctx = buildCtx(chart, analysis);
    const onSlot = (slot: string, evalCtx: EvalContext): void => {
      for (const e of bySlot.get(slot) ?? []) {
        if (e.asserts.length === 0 || !evaluateCondition(e.when, evalCtx)) continue;
        if (e.asserts.every((a) => evaluateCondition(a, evalCtx))) continue;
        const key = e.id;
        const d = defects.get(key) ?? { entry: e.id, slot, firstSample: idx, count: 0 };
        d.count++;
        defects.set(key, d);
      }
    };
    const report = assembleReport({ chart, analysis, ctx, ...o, onSlot });
    let hadFallback = false;
    for (const ev of report.events) {
      const bucket = ev.type === 'fallback_used' ? m.fallbackUsed : m.slotEmpty;
      bucket[ev.slot] = (bucket[ev.slot] ?? 0) + 1;
      hadFallback = true;
    }
    if (hadFallback) m.reportsWithFallback++;
    const chapters: Record<number, number> = {};
    let total = 0;
    for (const ch of report.chapters) {
      if (ch.id < 1 || ch.id > 7) continue;
      const n = chapterParas(ch.blocks).reduce((s, p) => s + textLength(p.text), 0);
      chapters[ch.id] = n;
      total += n;
    }
    const lo = chart.hourKnown ? TOTAL[0] : TOTAL_NOHOUR_MIN;
    if (total >= lo && total <= TOTAL[1]) m.lengthPass++;
    m.lengths?.push({ chapters, total });
    const rc = rcheck(report, ctx, o.words);
    for (const rule of new Set(rc.failures.map((f) => f.rule))) {
      m.rcheckFailedReports[rule] = (m.rcheckFailedReports[rule] ?? 0) + 1;
    }
  });
  const valid = m.samples - m.invalidInputs;
  m.lengthPassRate = valid > 0 ? m.lengthPass / valid : 0;
  m.assertDefects = [...defects.values()].sort(
    (a, b) => b.count - a.count || (a.entry < b.entry ? -1 : 1),
  );
  return m;
}
