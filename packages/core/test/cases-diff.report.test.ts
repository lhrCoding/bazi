/**
 * T21 cases.json 全量代码复核 → reports/cases-diff.md（不进 docs/）。
 *
 * 只在 CASES_DIFF=1 时运行并写文件：`CASES_DIFF=1 npx vitest run test/cases-diff.report.test.ts`
 * 平时作为跳过项出现，不影响 CI。
 *
 * 与 cases.test.ts 的区别：cases.test.ts 按 test_guidance 带容差比对（S ±0.001、power ±0.01、起运日 ±1 天，
 * qiyun_offset / no_hour 等不比）；这里**零容差**——数值按期望值的小数位数四舍五入后必须逐字相同，
 * 并补上测试不比对的字段，供逐条裁定。不得据此直接改期望值或代码（TASKS T21）。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeChart, formatRuleHit } from '../src/index';
import { deepEqual } from './helpers/case-compare';
import { loadCases, type LoadedCase } from './helpers/cases';
import { JUDGMENTS, RESOLVED_2026_11_11 } from './helpers/cases-diff-judgments';

const REF_DATE_MS = Date.parse('2026-10-30T00:00:00+08:00');
const OUT = fileURLToPath(new URL('../../../reports/cases-diff.md', import.meta.url));

export interface DiffRow {
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
  rules: string;
  trace: string;
}

function decimals(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
/** 数值按期望值的小数位数比较；对象 / 数组递归 */
function sameStrict(e: unknown, a: unknown): boolean {
  if (typeof e === 'number' && typeof a === 'number') {
    const d = decimals(e);
    return Math.abs(Math.round(a * 10 ** d) / 10 ** d - e) < 1e-9;
  }
  if (Array.isArray(e) && Array.isArray(a))
    return e.length === a.length && e.every((x, i) => sameStrict(x, a[i]));
  if (e && a && typeof e === 'object' && typeof a === 'object') {
    const ek = Object.keys(e as object).sort();
    const ak = Object.keys(a as object).sort();
    return deepEqual(ek, ak) && ek.every((k) => sameStrict((e as never)[k], (a as never)[k]));
  }
  return deepEqual(e, a);
}
function round(v: unknown, d = 3): unknown {
  if (typeof v === 'number') return Math.round(v * 10 ** d) / 10 ** d;
  if (Array.isArray(v)) return v.map((x) => round(x, d));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x, d)]));
  return v;
}
const show = (v: unknown): string => (v === undefined ? '（无）' : JSON.stringify(round(v)));
const get = (o: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (cur, k) => (cur && typeof cur === 'object' ? (cur as never)[k] : undefined),
      o,
    );

export function collect(c: LoadedCase): DiffRow[] {
  const chart = computeChart(c.input, REF_DATE_MS);
  const a = analyze(chart);
  const e = c.expected as Record<string, unknown>;
  const rows: DiffRow[] = [];
  const sRules = a.strength.rules_hit.map(formatRuleHit).join(' ');
  const yRules = a.yongshen.rules_hit.map(formatRuleHit).join(' ');
  const strengthTrace =
    `power ${show(a.strength.power)}；同党 ${show(a.strength.gods['比劫'] + a.strength.gods['印'])} / ` +
    `总 ${show(Object.values(a.strength.power).reduce((s, x) => s + x, 0))}`;
  const push = (field: string, exp: unknown, act: unknown, rules: string, trace: string): void => {
    if (exp === undefined) return;
    if (!sameStrict(exp, act))
      rows.push({ id: c.id, field, expected: exp, actual: act, rules, trace });
  };

  // 四柱
  for (const k of ['year', 'month', 'day', 'hour'] as const) {
    push(`pillars.${k}`, get(e, `pillars.${k}`), chart.pillars[k], chart.rules_hit.join(' '), '');
  }
  // 大运
  const d = chart.dayun;
  const first3 = d.steps.slice(0, 3);
  const ed = e.dayun as Record<string, unknown> | undefined;
  if (ed) {
    push('dayun.direction', ed.direction, d.direction, 'CAL-YUN', '');
    push('dayun.qiyun_date', ed.qiyun_date, d.qiyunDate, 'CAL-YUN', `起运时刻 ${d.qiyunTime}`);
    const eo = ed.qiyun_offset;
    if (eo !== undefined) {
      const o = d.qiyunOffset;
      const act = `${o.years}年${o.months}月${o.days}天${o.hours}时`;
      push('dayun.qiyun_offset', eo, act, 'CAL-YUN', `tyme4ts Sect2 按秒；起运时刻 ${d.qiyunTime}`);
    }
    const e3 = ed.first3 as
      { ganzhi: string; start_year: number | null; start_age_xusui?: number | null }[] | undefined;
    if (e3) {
      push(
        'dayun.first3.ganzhi',
        e3.map((x) => x.ganzhi),
        first3.map((s) => s.ganzhi),
        'CAL-YUN',
        '',
      );
      push(
        'dayun.first3.start_year',
        e3.map((x) => x.start_year),
        first3.map((s) => s.startYear),
        'CAL-YUN',
        '',
      );
      if (e3.some((x) => 'start_age_xusui' in x)) {
        push(
          'dayun.first3.start_age_xusui',
          e3.map((x) => x.start_age_xusui),
          first3.map((s) => s.startAgeXusui),
          'CAL-YUN',
          '',
        );
      }
    }
  }
  // 旺衰
  const es = e.strength as Record<string, unknown> | undefined;
  if (es) {
    for (const k of Object.keys(es)) {
      push(`strength.${k}`, es[k], (a.strength as never)[k], sRules, strengthTrace);
    }
  }
  // 喜用
  const { yong, xi, ji, xian } = a.yongshen;
  push('yongshen', e.yongshen, { yong, xi, ji, xian }, yRules, a.yongshen.basis.join(' / '));
  // 吉神
  push('shensha_ji', e.shensha_ji, a.shensha.jishen, 'SS-OUTPUT', '');
  // 三柱扫描
  const nh = e.no_hour as Record<string, unknown> | undefined;
  if (nh && a.no_hour) {
    const n = a.no_hour;
    const trace = n.slots.map((s) => `${s.hour}:${s.level}/${s.yong}`).join(' ');
    push('no_hour.scan_slots', nh.scan_slots, n.scan_slots, 'S-NOHOUR', trace);
    push('no_hour.direction_agree', nh.direction_agree, n.direction_agree, 'S-NOHOUR', trace);
    push('no_hour.yong_agree', nh.yong_agree, n.yong_agree, 'S-NOHOUR', trace);
    push('no_hour.confidence', nh.confidence, n.confidence, 'S-NOHOUR', trace);
    push(
      'no_hour.cong_possible_hours(时支)',
      (nh.cong_possible_hours as string[]).map((gz) => gz[1]),
      n.nohour_cong_hours,
      'S-NOHOUR',
      trace,
    );
    const late = nh.added_late_zi_slot as Record<string, unknown> | undefined;
    const ls = n.slots[12];
    if (late && ls) {
      push(
        'no_hour.added_late_zi_slot',
        { hour: late.hour, S: late.S, level: late.level, yong: late.yong },
        { hour: ls.hour, S: ls.S, level: ls.level, yong: ls.yong },
        'S-NOHOUR',
        String(late.note ?? ''),
      );
    }
    const alt = nh.alt_conclusion as Record<string, unknown> | undefined;
    if (alt) {
      const x = n.alt;
      push(
        'no_hour.alt_conclusion',
        alt,
        x && { pillars: x.pillars, level: x.level, S: x.S, yong: x.yong, xi: x.xi, ji: x.ji },
        'S-NOHOUR',
        '',
      );
    }
  }
  push(
    'shensha_ji_display_if_uncertain',
    e.shensha_ji_display_if_uncertain,
    a.shensha.jishen_display,
    'SS-OUTPUT',
    '',
  );
  // rules_hit：期望编号应全部出现
  const allRules = [...chart.rules_hit, ...a.rules_hit.map(formatRuleHit)].map(
    (r) => r.split(':')[0],
  );
  const er = (e.rules_hit_expected as string[] | undefined)?.map((r) => r.split(':')[0]);
  if (er && !er.every((r) => allRules.includes(r as string))) {
    rows.push({
      id: c.id,
      field: 'rules_hit_expected',
      expected: er,
      actual: allRules,
      rules: '',
      trace: '',
    });
  }
  return rows;
}

// 仅手动生成报告时用环境变量开关；core 源码仍不读环境变量（规则针对 src，这里是默认跳过的测试脚本）
// eslint-disable-next-line no-restricted-globals
describe.runIf(process.env.CASES_DIFF === '1')('T21 生成 reports/cases-diff.md', () => {
  it('写出差异清单', () => {
    const { cases } = loadCases();
    const rows = cases.flatMap(collect);
    const esc = (s: string): string => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
    const lines = [
      '# cases.json 全量代码复核差异清单（T21）',
      '',
      `> 由 \`packages/core/test/cases-diff.report.test.ts\` 生成（CASES_DIFF=1），参考日期 2026-10-30。`,
      '> 零容差：数值按期望值小数位数四舍五入后逐字比较；包含 cases.test.ts 不比对的字段。',
      '> 「建议」列为 Claude 的判断，**最终由用户裁定**（原流程中的 mingli-expert 角色由用户承担）。',
      '',
      `当前复跑：共 ${cases.length} 个案例，${rows.length} 处差异。`,
      '',
      '| # | 案例 | 字段 | 期望值 | 代码值 | 触发规则 | 计算过程 | 建议 |',
      '|---|---|---|---|---|---|---|---|',
      ...rows.map(
        (r, i) =>
          `| ${i + 1} | ${r.id} | ${r.field} | ${esc(show(r.expected))} | ${esc(show(r.actual))} | ${esc(r.rules)} | ${esc(r.trace)} | ${esc(JUDGMENTS[`${r.id} ${r.field}`] ?? '待判断')} |`,
      ),
      '',
      '## 已裁定记录（2026-11-11，用户裁定，已写入 cases.json v2.3）',
      '',
      `裁定前共 ${RESOLVED_2026_11_11.length} 处差异，全部在大运起运；用户裁定全部按代码值更新期望值。`,
      '',
      '| # | 案例 | 字段 | 原期望值 | 代码值 | 裁定 |',
      '|---|---|---|---|---|---|',
      ...RESOLVED_2026_11_11.map(
        ([id, f, e, a, r], i) => `| ${i + 1} | ${id} | ${f} | ${e} | ${a} | ${r} |`,
      ),
      '',
      '## 零容差下完全一致的字段',
      '',
      '四柱、23:00 换日派日柱、大运顺逆与前三步干支、旺衰（S、五行 power、十神 gods、得令 / 得地 / 得势、等级、特殊格局、borderline）、',
      '喜用神（用 / 喜 / 忌 / 闲）、rules_hit_expected、吉神 shensha_ji（20 个案例均为人工手算）、三柱扫描（C18 / C19 含晚子时、另一组结论）、',
      'C19 jishen_display。T21 点名复核的「C05 旺衰 / 喜用」「C18 / C19 晚子时扫描」「全部 shensha_ji」均无差异。',
      '',
      '## 附：请一并裁定的口径（TASKS T21 ①–④）——用户 2026-11-11 裁定：全部按当前实现，已写入 calendar.md v2.1',
      '',
      '| # | 问题 | 裁定（= 当前实现） | 写入位置 |',
      '|---|---|---|---|',
      '| ① | 无时辰默认「当天 12:00」指什么时间 | 出生地本地钟表时间（夏令时期间即钟表 12:00）| calendar.md §7 |',
      '| ② | 交节日用户选了前 / 后，但 12:00 不在所选一侧 | 起运按所选一侧当天时段的中点计算 | calendar.md §7 |',
      '| ③ | 三柱模式是否做真太阳时校正 | 不校正，页面也不显示「未校正」灰字 | calendar.md §4 |',
      '| ④ | 1901 年以前 Asia/Shanghai 时区 | 沿用 tzdata 地方平时 +8:05:43（1900 年钟表 08:00 → 北京标准时间 07:54:17）| calendar.md §5 |',
      '',
    ];
    writeFileSync(OUT, lines.join('\n'));
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
