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
import { clockToUtcMsForTest } from './helpers/clock';
import { computeYearMonth } from '../src/bazi/year-month';

const { cases } = loadCases();

/**
 * 引擎实际输出 → 按字段键扁平化。
 * T13 起统一改为 computeChart / analyze；在此之前逐个接入已实现的模块：
 * - T04 年柱、月柱：computeYearMonth(出生绝对时刻)。
 *   绝对时刻暂由测试工具按 IANA 时区换算（正式 CAL-TZ 见 T05）；农历案例暂用案例给出的公历时间（农历换算见 T08）；
 *   无时辰按 cases.json 约定的 12:00 本地钟表时间（CAL-NOHOUR，正式实现见 T11）。
 */
function computeActual(c: LoadedCase): CaseActual {
  const clock = c.solarDateTime ?? `${c.solarDate} 12:00`;
  const ym = computeYearMonth(clockToUtcMsForTest(clock, c.raw.input.timezone));
  return { 'pillars.year': ym.year, 'pillars.month': ym.month };
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
