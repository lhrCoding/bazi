/**
 * 拼装上下文 ctx（TASKS T27 基础字段；rules/report-sections.md §0 R-CTX、texts/README.md §3）。
 *
 * ctx 是拼装引擎的唯一输入：只含代码算好的数据，不含自由文本、不含出生日期（只给周岁 current_age）。
 * T27 buildCtxBase：chart_key、profile、pillars、day、month、el、ten_gods（细分十神）、strength、gods、power_pct、yongshen。
 * T28 buildCtx：再加 dayun / liunian item、原局 relations、ten_gods.persona、career、partner、wealth、dayun_summary、shensha。
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
import { rankAliens } from '../rules/yongshen';
import { LIU_CHONG, LIU_HE, type Tier, type TierGroup } from '../rules/scoring';
import type { Analysis, GodGroup, JishenName, StrengthLevel, WuXing } from '../rules/types';
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
/** 只消除二进制表示误差（与 rules/yongshen.ts、strength-level.ts 同口径）：差值 < 1e-9 视为并列 */
const FP_EPS = 1e-9;

/** 力量降序比较器；并列（含浮点误差）按 TOP_PRIORITY */
export function byPower(
  v: Readonly<Record<GodGroup, number>>,
): (a: GodGroup, b: GodGroup) => number {
  return (a, b) => {
    if (v[a] > v[b] + FP_EPS) return -1;
    if (v[b] > v[a] + FP_EPS) return 1;
    return TOP_PRIORITY.indexOf(a) - TOP_PRIORITY.indexOf(b);
  };
}

/** 按力量取最大；并列按 TOP_PRIORITY */
function topOf<G extends GodGroup>(groups: readonly G[], v: Record<GodGroup, number>): G {
  return [...groups].sort(byPower(v))[0] as G;
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
  // 与规则引擎同一口径（含浮点容差）：异党并列 官杀 > 食伤 > 财（yongshen.md §3.1，直接用 rankAliens）；
  // 同党 比劫 ≥ 印 取比劫（§3.2）。T35 动态抽样发现此前直接比浮点数，并列时与 fy_rule 不一致。
  const topYidang = rankAliens(st.gods)[0] as '食伤' | '财' | '官杀';
  const topTongdang: '比劫' | '印' = st.gods['比劫'] >= st.gods['印'] - FP_EPS ? '比劫' : '印';
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
export const CTX_STRUCTURAL_KEYS = ['chart_key', 'pillars', 'dayun', 'liunian', 'qiyun'] as const;

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

// ---------------------------------------------------------------- T28：大运 / 流年 / 关系 / 性格 / 领域 / 吉神

export type Role = '用' | '喜' | '忌' | '闲';
export type BranchPos = '年支' | '月支' | '日支' | '时支';
export interface Relation {
  type: '冲' | '合';
  a: string;
  b: string;
}

export interface DayunItem {
  idx: number;
  ganzhi: GanZhi;
  start_year: number;
  end_year: number;
  stem_ten_god: TenGod;
  stem_god: GodGroup;
  score: number;
  tier: Tier;
  tier_group: TierGroup;
  stem_role: Role;
  branch_role: Role;
  relations: Relation[];
  phase: 'past' | 'current' | 'next' | 'far';
}

export interface LiunianItem {
  year: number;
  ganzhi: GanZhi;
  dayun: GanZhi | null;
  stem_ten_god: TenGod;
  stem_god: GodGroup;
  score: number;
  tier: Tier;
  tier_group: TierGroup;
  stem_role: Role;
  branch_role: Role;
  relations: Relation[];
}

export interface Ctx extends Omit<CtxBase, 'ten_gods'> {
  ten_gods: CtxBase['ten_gods'] & { persona: TenGod[] };
  relations: Relation[];
  career: { mode: GodGroup };
  partner: { role: Role; pct: number };
  /** 财星的角色与力量档（CH7-WEALTH；docs/QUESTIONS.md Q5） */
  wealth: { role: Role; level: '强' | '中' | '弱' };
  /** 已过 / 更远大运中占多数的 tier_group（CH5-PAST / CH5-FAR；Q5）；没有对应大运为 null */
  dayun_summary: { past_group: TierGroup | null; far_group: TierGroup | null };
  shensha: JishenName[];
  shensha_first: JishenName | null;
  dayun: DayunItem[];
  liunian: LiunianItem[];
  /** 起运（第 5 章 INTRO 依据）：周岁、顺逆、是否约数（三柱） */
  qiyun: { age: number; direction: '顺' | '逆'; approximate: boolean };
}

const POS: readonly [BranchPos, keyof Chart['pillars']][] = [
  ['年支', 'year'],
  ['月支', 'month'],
  ['日支', 'day'],
  ['时支', 'hour'],
];
/** 并列多数时偏保守：守 > 平 > 好（Q5） */
const GROUP_TIE: readonly TierGroup[] = ['守', '平', '好'];
const TEN_GOD_GROUP: Readonly<Record<TenGod, GodGroup>> = {
  比肩: '比劫',
  劫财: '比劫',
  食神: '食伤',
  伤官: '食伤',
  偏财: '财',
  正财: '财',
  七杀: '官杀',
  正官: '官杀',
  偏印: '印',
  正印: '印',
};
/** 每组的两个十神：[与日干同阴阳（偏）, 异阴阳（正）] */
const GROUP_GODS: Readonly<Record<GodGroup, readonly [TenGod, TenGod]>> = {
  比劫: ['比肩', '劫财'],
  食伤: ['食神', '伤官'],
  财: ['偏财', '正财'],
  官杀: ['七杀', '正官'],
  印: ['偏印', '正印'],
};

export function roleOf(e: WuXing, ys: Pick<CtxBase['yongshen'], 'yong' | 'xi' | 'ji'>): Role {
  if (e === ys.yong) return '用';
  if (ys.xi.includes(e)) return '喜';
  if (ys.ji.includes(e)) return '忌';
  return '闲';
}

/** 两支之间的六冲 / 六合（无关系为 null） */
function zhiRelation(x: Zhi, y: Zhi): '冲' | '合' | null {
  if (LIU_CHONG[x] === y) return '冲';
  if (LIU_HE[x] === y) return '合';
  return null;
}

/** 原局支与支的冲合：a 为靠后的柱、b 为靠前的柱（与 §0 示例 {冲, 日支, 月支} 一致）；三柱不看时支 */
export function natalRelations(pillars: Chart['pillars']): Relation[] {
  const out: Relation[] = [];
  const have = POS.filter(([, k]) => pillars[k] !== null);
  for (let j = 1; j < have.length; j++) {
    for (let i = 0; i < j; i++) {
      const [pa, ka] = have[j] as [BranchPos, keyof Chart['pillars']];
      const [pb, kb] = have[i] as [BranchPos, keyof Chart['pillars']];
      const t = zhiRelation((pillars[ka] as GanZhi)[1] as Zhi, (pillars[kb] as GanZhi)[1] as Zhi);
      if (t) out.push({ type: t, a: pa, b: pb });
    }
  }
  return out;
}

/** 运支（大运支 / 流年支）与原局各支的冲合 */
function incomingRelations(z: Zhi, label: string, pillars: Chart['pillars']): Relation[] {
  const out: Relation[] = [];
  for (const [pos, k] of POS) {
    const gz = pillars[k];
    if (gz === null) continue;
    const t = zhiRelation(z, gz[1] as Zhi);
    if (t) out.push({ type: t, a: label, b: pos });
  }
  return out;
}

/**
 * R-PERSONA：①月干十神；②力量最大的十神组中优先取透干（年、月、时干，按月→年→时）的那个，
 * 未透干则取地支本气出现的（月→日→年→时支），都没有取同阴阳（偏）的；③去重取前两个，
 * 不足两个时按力量次序继续取下一组。三柱时不看时干、时支。
 */
export function personaOf(base: CtxBase, godValues: Record<GodGroup, number>): TenGod[] {
  const tg = base.ten_gods;
  const stems = [tg.month_stem, tg.year_stem, tg.hour_stem].filter((x): x is TenGod => x !== null);
  const branches = [tg.month_branch, tg.day_branch, tg.year_branch, tg.hour_branch].filter(
    (x): x is TenGod => x !== null,
  );
  const pick = (g: GodGroup): TenGod => {
    const [pian, zheng] = GROUP_GODS[g];
    return (
      stems.find((s) => TEN_GOD_GROUP[s] === g) ??
      branches.find((b) => TEN_GOD_GROUP[b] === g) ??
      (stems.includes(zheng) ? zheng : pian)
    );
  };
  const groups = [...GODS].sort(byPower(godValues));
  const out: TenGod[] = [tg.month_stem];
  for (const g of groups) {
    if (out.length >= 2) break;
    const p = pick(g);
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, 2);
}

function majority(groups: readonly TierGroup[]): TierGroup | null {
  if (groups.length === 0) return null;
  const n = (g: TierGroup): number => groups.filter((x) => x === g).length;
  return [...GROUP_TIE].sort(
    (a, b) => n(b) - n(a) || GROUP_TIE.indexOf(a) - GROUP_TIE.indexOf(b),
  )[0] as TierGroup;
}

/** refDate 所在公历年（北京时间） */
function refYearOf(refDateMs: number): number {
  return new Date(refDateMs + 8 * 3600 * 1000).getUTCFullYear();
}

export function buildCtx(chart: Chart, analysis: Analysis): Ctx {
  const base = buildCtxBase(chart, analysis);
  if (analysis.scores === null) throw new Error('buildCtx 需要含大运 / 流年评分的 Analysis');
  const st = analysis.strength;
  const ys = base.yongshen;
  const dayGan = base.day.stem;
  const role = (e: WuXing): Role => roleOf(e, ys);
  const stemInfo = (gz: GanZhi) => {
    const tgod = tenGodOf(dayGan, gz[0] as Gan);
    return {
      stem_ten_god: tgod,
      stem_god: TEN_GOD_GROUP[tgod],
      stem_role: role(ganWuXing(gz[0] as Gan) as WuXing),
      branch_role: role(ganWuXing(mainQi(gz[1] as Zhi)) as WuXing),
    };
  };

  // 大运 phase：refDate 年份所在步 = current，其后一步 = next，再往后 = far，之前 = past；尚未起运时第一步为 next
  const refYear = refYearOf(chart.refDate);
  const steps = chart.dayun.steps;
  let cur = steps.findIndex((s) => s.startYear <= refYear && refYear <= s.endYear);
  const nextIdx = cur >= 0 ? cur + 1 : steps.findIndex((s) => s.startYear > refYear);
  if (cur < 0 && nextIdx < 0) cur = steps.length - 1;
  const dayun: DayunItem[] = steps.map((s, idx) => {
    const sc = analysis.scores?.dayun[idx];
    if (!sc) throw new Error(`缺少第 ${idx} 步大运评分`);
    return {
      idx,
      ganzhi: s.ganzhi,
      start_year: s.startYear,
      end_year: s.endYear,
      ...stemInfo(s.ganzhi),
      score: sc.score,
      tier: sc.tier,
      tier_group: sc.tier_group,
      relations: incomingRelations(s.ganzhi[1] as Zhi, '大运支', chart.pillars),
      phase:
        idx === cur
          ? 'current'
          : idx === nextIdx
            ? 'next'
            : idx < (cur >= 0 ? cur : nextIdx)
              ? 'past'
              : 'far',
    };
  });

  const liunian: LiunianItem[] = analysis.scores.liunian.map((l) => ({
    year: l.year,
    ganzhi: l.ganzhi,
    dayun: l.dayun,
    ...stemInfo(l.ganzhi),
    score: l.score,
    tier: l.tier,
    tier_group: l.tier_group,
    relations: l.relations.map(({ type, a, b }) => ({ type, a, b })),
  }));

  const favorableGroups = GODS.filter((g) => ys.favorable.includes(base.el[g]));
  const careerMode = [...favorableGroups].sort(byPower(st.gods))[0] as GodGroup;
  const partnerGroup: GodGroup = base.profile.gender === '男' ? '财' : '官杀';
  const caiPct = base.gods['财_pct'];
  const jishen = analysis.shensha.jishen_display.map((j) => j.name);

  return {
    ...base,
    ten_gods: { ...base.ten_gods, persona: personaOf(base, st.gods) },
    relations: natalRelations(chart.pillars),
    career: { mode: careerMode },
    partner: { role: role(base.el[partnerGroup]), pct: base.gods[`${partnerGroup}_pct`] },
    wealth: { role: role(base.el['财']), level: caiPct >= 25 ? '强' : caiPct < 10 ? '弱' : '中' },
    dayun_summary: {
      past_group: majority(dayun.filter((d) => d.phase === 'past').map((d) => d.tier_group)),
      far_group: majority(dayun.filter((d) => d.phase === 'far').map((d) => d.tier_group)),
    },
    shensha: jishen,
    shensha_first: jishen[0] ?? null,
    dayun,
    liunian,
    qiyun: {
      age: chart.dayun.qiyunAge,
      direction: chart.dayun.direction,
      approximate: chart.dayun.approximate,
    },
  };
}
