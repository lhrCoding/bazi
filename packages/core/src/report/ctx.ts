/**
 * 拼装上下文 ctx（TASKS T27 基础字段；rules/report-sections.md §0 R-CTX、texts/README.md §3）。
 *
 * ctx 是拼装引擎的唯一输入：只含代码算好的数据，不含自由文本、不含出生日期（只给周岁 current_age）。
 * 本任务（T27）：chart_key、profile、pillars、day、month、el、ten_gods（细分十神，persona 见 T28）、strength、gods、
 * power_pct、yongshen。T28 追加：dayun / liunian item、relations、ten_gods.persona、career、partner、shensha。
 *
 * 口径：
 * - 百分比 = round(x / total × 100)（total 为 strength.md 的 total，不含日干；四舍五入取整）。
 *   S_pct = round(S × 100)，yidang_pct = 100 − S_pct（两者相加恒为 100）；各组百分比各自取整，合计可能差 1。
 * - top_yidang：食伤 / 财 / 官杀 中最大，并列按 官杀 > 食伤 > 财（与 yongshen.md §3.1 一致）；
 *   top_tongdang：比劫 ≥ 印 取比劫（yongshen.md §3.2）；top：五组中最大，并列按 官杀 > 食伤 > 财 > 比劫 > 印。
 * - 地支十神 = 地支本气藏干相对日干的十神。
 * - paradox：得令且偏弱 → 得令却身弱；失令且偏旺 → 失令却身旺；否则 null。
 * - current_age：参考日期（Chart.refDate，北京时间）时的周岁。
 */
import type { Gan, GanZhi, Zhi } from '../bazi/ganzhi';
import { HIDDEN_STEMS, ganWuXing, tenGodOf, type TenGod } from '../bazi/ten-gods';
import type { Chart } from '../bazi/types';
import { elementOfGroup, godGroupOf } from '../rules/strength-power';
import type { Analysis, GodGroup, StrengthLevel, WuXing } from '../rules/types';
import { GLOBAL_FIELDS } from '../texts/fields';

export interface CtxBase {
  chart_key: string;
  profile: {
    gender: '男' | '女';
    time_known: boolean;
    confidence: '高' | '中' | '低';
    current_age: number;
    tst_status: '已校正' | '未校正';
    uncertain_year_month: boolean;
  };
  pillars: { year: GanZhi; month: GanZhi; day: GanZhi; hour: GanZhi | null };
  day: { stem: Gan; element: WuXing; yinyang: '阳' | '阴' };
  month: { branch: Zhi; season: '春' | '夏' | '秋' | '冬'; main_qi: Gan; main_god: GodGroup };
  el: Record<GodGroup, WuXing>;
  ten_gods: {
    year_stem: TenGod;
    month_stem: TenGod;
    hour_stem: TenGod | null;
    year_branch: TenGod;
    month_branch: TenGod;
    day_branch: TenGod;
    hour_branch: TenGod | null;
  };
  strength: {
    level: StrengthLevel;
    direction: '偏弱' | '偏旺';
    special: Analysis['strength']['special'];
    borderline: boolean;
    paradox: '得令却身弱' | '失令却身旺' | null;
    S_pct: number;
    yidang_pct: number;
    de_ling: boolean;
    de_di: boolean;
    de_shi: number;
    nohour_cong_possible: boolean;
    nohour_cong_hours: Zhi[];
  };
  gods: Record<`${GodGroup}_pct`, number> & {
    top_yidang: '食伤' | '财' | '官杀';
    top_tongdang: '比劫' | '印';
    top: GodGroup;
    top_yidang_pct: number;
    top_tongdang_pct: number;
  };
  power_pct: Record<WuXing, number>;
  yongshen: {
    yong: WuXing;
    xi: WuXing[];
    xi1: WuXing;
    ji: WuXing[];
    ji1: WuXing;
    xian: WuXing[];
    favorable: WuXing[];
    yong_god: GodGroup;
    xi1_god: GodGroup;
    ji1_god: GodGroup;
    fy_rule: Analysis['yongshen']['fy_rule'];
    swap: boolean;
    swap_from: WuXing | null;
    swap_to: WuXing | null;
    swap_from_god: GodGroup | null;
    swap_to_god: GodGroup | null;
    th: Analysis['yongshen']['th'];
    th_element: WuXing | null;
    tg: boolean;
    tg_element: WuXing | null;
  };
}

const GODS: readonly GodGroup[] = ['比劫', '印', '食伤', '财', '官杀'];
const WUXING: readonly WuXing[] = ['木', '火', '土', '金', '水'];
/** 并列时的优先顺序 */
const TOP_PRIORITY: readonly GodGroup[] = ['官杀', '食伤', '财', '比劫', '印'];
const SEASON: Readonly<Record<Zhi, '春' | '夏' | '秋' | '冬'>> = {
  寅: '春',
  卯: '春',
  辰: '春',
  巳: '夏',
  午: '夏',
  未: '夏',
  申: '秋',
  酉: '秋',
  戌: '秋',
  亥: '冬',
  子: '冬',
  丑: '冬',
};
const YANG_STEMS: readonly Gan[] = ['甲', '丙', '戊', '庚', '壬'];

function mainQi(z: Zhi): Gan {
  return (HIDDEN_STEMS[z][0] as readonly [Gan, number])[0];
}

export function pct(x: number, total: number): number {
  return total > 0 ? Math.round((x / total) * 100) : 0;
}

/** 按值取最大；并列按 TOP_PRIORITY */
function topOf<G extends GodGroup>(groups: readonly G[], v: Record<GodGroup, number>): G {
  return [...groups].sort(
    (a, b) => v[b] - v[a] || TOP_PRIORITY.indexOf(a) - TOP_PRIORITY.indexOf(b),
  )[0] as G;
}

/** chart_key = 四柱干支拼接（无时辰 --）| 性别 | 是否有时辰（1/0）（texts/README.md §5.2） */
export function chartKeyOf(pillars: Chart['pillars'], gender: '男' | '女'): string {
  const known = pillars.hour !== null;
  return `${pillars.year}${pillars.month}${pillars.day}${pillars.hour ?? '--'}|${gender}|${known ? 1 : 0}`;
}

/** refDate（毫秒）时的周岁，按北京时间日期计 */
export function ageAt(solarDate: string, refDateMs: number): number {
  const d = new Date(refDateMs + 8 * 3600 * 1000);
  const [y, m, day] = solarDate.split('-').map(Number) as [number, number, number];
  const ry = d.getUTCFullYear();
  const rm = d.getUTCMonth() + 1;
  const rd = d.getUTCDate();
  return ry - y - (rm < m || (rm === m && rd < day) ? 1 : 0);
}

export function buildCtxBase(chart: Chart, analysis: Analysis): CtxBase {
  const { pillars } = chart;
  const st = analysis.strength;
  const ys = analysis.yongshen;
  const dayGan = pillars.day[0] as Gan;
  const dayEl = ganWuXing(dayGan) as WuXing;
  const monthZhi = pillars.month[1] as Zhi;
  const monthQi = mainQi(monthZhi);
  const godOf = (e: WuXing): GodGroup => godGroupOf(dayEl, e);
  const branchGod = (gz: GanZhi | null): TenGod | null =>
    gz === null ? null : tenGodOf(dayGan, mainQi(gz[1] as Zhi));

  const total = st.total;
  const godsPct = Object.fromEntries(
    GODS.map((g) => [`${g}_pct`, pct(st.gods[g], total)]),
  ) as Record<`${GodGroup}_pct`, number>;
  const topYidang = topOf(['食伤', '财', '官杀'] as const, st.gods);
  const topTongdang: '比劫' | '印' = st.gods['比劫'] >= st.gods['印'] ? '比劫' : '印';
  const S_pct = Math.round(st.S * 100);
  const paradox =
    st.de_ling && st.direction === '偏弱'
      ? '得令却身弱'
      : !st.de_ling && st.direction === '偏旺'
        ? '失令却身旺'
        : null;
  const nh = analysis.no_hour;

  return {
    chart_key: chartKeyOf(pillars, chart.input_echo.gender),
    profile: {
      gender: chart.input_echo.gender,
      time_known: chart.hourKnown,
      confidence: analysis.confidence,
      current_age: ageAt(chart.solar_date, chart.refDate),
      tst_status: chart.tst_status,
      uncertain_year_month: chart.uncertain.month_pillar !== null,
    },
    pillars: { ...pillars },
    day: { stem: dayGan, element: dayEl, yinyang: YANG_STEMS.includes(dayGan) ? '阳' : '阴' },
    month: {
      branch: monthZhi,
      season: SEASON[monthZhi],
      main_qi: monthQi,
      main_god: godOf(ganWuXing(monthQi) as WuXing),
    },
    el: Object.fromEntries(GODS.map((g) => [g, elementOfGroup(dayEl, g)])) as Record<
      GodGroup,
      WuXing
    >,
    ten_gods: {
      year_stem: chart.ten_gods.year,
      month_stem: chart.ten_gods.month,
      hour_stem: chart.ten_gods.hour,
      year_branch: branchGod(pillars.year) as TenGod,
      month_branch: branchGod(pillars.month) as TenGod,
      day_branch: branchGod(pillars.day) as TenGod,
      hour_branch: branchGod(pillars.hour),
    },
    strength: {
      level: st.level,
      direction: st.direction,
      special: st.special,
      borderline: st.borderline,
      paradox,
      S_pct,
      yidang_pct: 100 - S_pct,
      de_ling: st.de_ling,
      de_di: st.de_di,
      de_shi: st.de_shi,
      nohour_cong_possible: nh?.nohour_cong_possible ?? false,
      nohour_cong_hours: [...(nh?.nohour_cong_hours ?? [])],
    },
    gods: {
      ...godsPct,
      top_yidang: topYidang,
      top_tongdang: topTongdang,
      top: topOf(GODS, st.gods),
      top_yidang_pct: godsPct[`${topYidang}_pct`],
      top_tongdang_pct: godsPct[`${topTongdang}_pct`],
    },
    power_pct: Object.fromEntries(WUXING.map((w) => [w, pct(st.power[w], total)])) as Record<
      WuXing,
      number
    >,
    yongshen: {
      yong: ys.yong,
      xi: [...ys.xi],
      xi1: ys.xi[0] as WuXing,
      ji: [...ys.ji],
      ji1: ys.ji[0] as WuXing,
      xian: [...ys.xian],
      favorable: [ys.yong, ...ys.xi],
      yong_god: godOf(ys.yong),
      xi1_god: godOf(ys.xi[0] as WuXing),
      ji1_god: godOf(ys.ji[0] as WuXing),
      fy_rule: ys.fy_rule,
      swap: ys.swap,
      swap_from: ys.swap_from,
      swap_to: ys.swap_to,
      swap_from_god: ys.swap_from === null ? null : godOf(ys.swap_from),
      swap_to_god: ys.swap_to === null ? null : godOf(ys.swap_to),
      th: ys.th,
      th_element: ys.th_element,
      tg: ys.tg,
      tg_element: ys.tg_element,
    },
  };
}

// ---------------------------------------------------------------- 校验（字段字典 texts/README.md §3）

/** ctx 中不属于字段字典、但作为结构数据存在的顶层键 */
export const CTX_STRUCTURAL_KEYS = ['chart_key', 'pillars', 'dayun', 'liunian'] as const;

/**
 * 按字段字典校验 ctx：字段存在、类型与取值域、nullable；ctx 里出现字典外的字段也报错。
 * @param allowMissing 允许暂缺的字段（T27 阶段 T28 的字段尚未构造）
 */
export function ctxProblems(
  ctx: Readonly<Record<string, unknown>>,
  allowMissing: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const get = (path: string): unknown => {
    let cur: unknown = ctx;
    for (const k of path.split('.')) {
      if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, k)) return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
  };
  for (const [path, spec] of Object.entries(GLOBAL_FIELDS)) {
    const v = get(path);
    if (v === undefined) {
      if (!allowMissing.includes(path)) problems.push(`${path}：缺失`);
      continue;
    }
    if (v === null) {
      if (!(spec.kind === 'enum' && spec.nullable)) problems.push(`${path}：不允许为 null`);
      continue;
    }
    const inDomain = (x: unknown, d: readonly string[]): boolean =>
      typeof x === 'string' && d.includes(x);
    const ok =
      spec.kind === 'enum'
        ? inDomain(v, spec.domain)
        : spec.kind === 'bool'
          ? typeof v === 'boolean'
          : spec.kind === 'int'
            ? Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= spec.max
            : spec.kind === 'list'
              ? Array.isArray(v) && v.every((x) => inDomain(x, spec.domain))
              : spec.kind === 'objectList'
                ? Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null)
                : typeof v === 'string';
    if (!ok) problems.push(`${path}：取值 ${JSON.stringify(v)} 不符合 ${spec.kind}`);
  }
  // 字典外字段
  const known = new Set(Object.keys(GLOBAL_FIELDS));
  for (const [k, v] of Object.entries(ctx)) {
    if ((CTX_STRUCTURAL_KEYS as readonly string[]).includes(k)) continue;
    if (known.has(k)) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const sub of Object.keys(v))
        if (!known.has(`${k}.${sub}`)) problems.push(`${k}.${sub}：不在字段字典`);
    } else problems.push(`${k}：不在字段字典`);
  }
  return problems;
}
