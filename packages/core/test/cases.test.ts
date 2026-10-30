/**
 * rules/cases.json 全量对照测试（T03 骨架）。
 *
 * - 每个注册字段 × 每个案例一条断言，容差按 _meta.test_guidance（见 helpers/case-compare.ts）。
 * - 尚未实现的字段在 PENDING_FIELDS 中显式列出：以 it.todo 出现在测试结果里，并在输出中打印清单。
 * - 期望值为 null（待 T21 代码复核补全）的字段同样以 it.todo 列出。
 * - 实现某字段后：从 PENDING_FIELDS 删掉它，并在下面的 computeActual 中输出该字段。
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_CHECKS,
  NOT_COMPARED,
  PENDING_FIELDS,
  checkCaseField,
  type CaseActual,
} from './helpers/case-compare';
import { loadCases, type LoadedCase } from './helpers/cases';
import { computeChart } from '../src/index';
import { computeStrengthPower } from '../src/rules';

const { cases } = loadCases();

/** 对照测试的参考日期（只影响流年，cases.json 不含流年字段）：2026-10-30 00:00 北京时间，毫秒时间戳。 */
const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');

/**
 * 引擎实际输出 → 按字段键扁平化。
 * T13 起统一走公开 API computeChart（BirthInput 由 loader 从案例 input 映射：农历含闰月、出生地 → placeCode、
 * 无时辰 → time = null），不再逐个调用内部模块。T15 起旺衰计分字段取自规则引擎 computeStrengthPower(chart.pillars)；
 * analyze(chart) 公开入口在喜用神全链（T17）完成后汇总，届时这里改走 analyze。
 */
function computeActual(c: LoadedCase): CaseActual {
  const chart = computeChart(c.input, REF_DATE_MS);
  const first3 = chart.dayun.steps.slice(0, 3);
  const sp = computeStrengthPower(chart.pillars);
  return {
    'pillars.year': chart.pillars.year,
    'pillars.month': chart.pillars.month,
    'pillars.day': chart.pillars.day,
    'pillars.hour': chart.pillars.hour,
    'alt.zi_huanri_day_pillar': chart.alt.zi_huanri_day_pillar,
    'dayun.direction': chart.dayun.direction,
    'dayun.first3.ganzhi': first3.map((s) => s.ganzhi),
    'dayun.first3.start_year': first3.map((s) => s.startYear),
    'dayun.qiyun_date': chart.dayun.qiyunDate,
    'strength.S': sp.S,
    'strength.power': sp.power,
    'strength.gods': sp.gods,
    'strength.de_ling': sp.de_ling,
    'strength.de_di': sp.de_di,
    'strength.de_shi': sp.de_shi,
  };
}

const actuals = new Map(cases.map((c) => [c.id, computeActual(c)]));
const actualOf = (c: LoadedCase): CaseActual => actuals.get(c.id) ?? {};

/** 期望值待复核的条目（与是否已实现无关，单独列出） */
const reviewItems = cases.flatMap((c) =>
  FIELD_CHECKS.flatMap((fc) => {
    const ev = fc.extract(c.expected);
    return ev.status === 'pendingReview' ? [{ id: c.id, key: fc.key, reason: ev.reason }] : [];
  }),
);

function applicableCount(key: string): number {
  const fc = FIELD_CHECKS.find((x) => x.key === key);
  return fc ? cases.filter((c) => fc.extract(c.expected).status !== 'absent').length : 0;
}

describe(`cases.json 对照（${cases.length} 个案例）`, () => {
  for (const fc of FIELD_CHECKS) {
    const task = PENDING_FIELDS[fc.key];
    if (task !== undefined) {
      it.todo(`[待实现 ${task}] ${fc.key}（${applicableCount(fc.key)} 个案例）`);
      continue;
    }
    describe(fc.key, () => {
      for (const c of cases) {
        const r = checkCaseField(fc, c.expected, actualOf(c));
        if (r.outcome === 'absent') continue;
        if (r.outcome === 'pendingReview') {
          it.todo(`[期望值待复核] ${c.id} ${fc.key}`);
          continue;
        }
        it(`${c.id} ${c.title}`, () => {
          expect(r.outcome, r.detail ?? '').toBe('pass');
        });
      }
    });
  }

  it('引擎输出的字段都已注册，且不再留在待实现清单中', () => {
    const known = new Set(FIELD_CHECKS.map((x) => x.key));
    for (const [id, a] of actuals) {
      for (const k of Object.keys(a)) {
        expect(known.has(k), `${id} 输出了未注册字段 ${k}`).toBe(true);
        expect(k in PENDING_FIELDS, `${id} 已输出 ${k}，请从 PENDING_FIELDS 中移除`).toBe(false);
      }
    }
  });

  it('输出跳过清单（待实现 / 期望值待复核 / 不比对）', () => {
    const lines: string[] = ['', '======== cases.json 对照：跳过清单 ========'];
    const pending = Object.entries(PENDING_FIELDS);
    lines.push(`【待实现】${pending.length} 个字段：`);
    for (const [k, t] of pending) lines.push(`  - ${k}（${t}，${applicableCount(k)} 个案例）`);
    lines.push(`【期望值待复核】${reviewItems.length} 项：`);
    for (const r of reviewItems) lines.push(`  - ${r.id} ${r.key}：${r.reason}`);
    lines.push(`【不比对】${Object.keys(NOT_COMPARED).length} 个字段：`);
    for (const [k, why] of Object.entries(NOT_COMPARED)) lines.push(`  - ${k}：${why}`);
    lines.push('==========================================');
    console.info(lines.join('\n'));

    // 清单必须与注册表一致：已实现字段数 + 待实现字段数 = 注册字段数
    const implemented = FIELD_CHECKS.filter((x) => !(x.key in PENDING_FIELDS));
    expect(implemented.length + pending.length).toBe(FIELD_CHECKS.length);
  });
});
