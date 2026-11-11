/**
 * 字段字典（TASKS T22；rules/texts/README.md §3）。
 *
 * 触发条件（when / asserts）与占位符只能引用这里的字段。每个字段有类型与取值域：
 * - enum：标量，取值必须在 domain 中；nullable 表示可能为 null（如三柱时的 hour_*）。
 * - bool / int：int 带闭区间 [min, max]，覆盖率穷举时按需取代表值。
 * - list：元素取值域为 domain（如五行列表）；objectList：元素为对象（relations），用 exists，或 contains / not_contains
 *   给一个对象按「给出的键全部相等」匹配元素（如 {type: 冲, a: 流年支, b: 日支}）。
 * - text：自由文本型数据（如 item.ganzhi），只用于占位符，不进入条件。
 * lint（T24 L2 / L3）与覆盖率穷举（T34）都以本表为准。
 */
import { DI_ZHI, TIAN_GAN } from '../bazi/ganzhi';
import { TEN_GOD_NAMES } from '../bazi/ten-gods';

export const WUXING = ['木', '火', '土', '金', '水'] as const;
export const GOD_GROUPS = ['比劫', '印', '食伤', '财', '官杀'] as const;
export const STRENGTH_LEVELS = ['身弱', '中和偏弱', '中和偏旺', '身旺', '从弱', '从强'] as const;
export const SPECIALS = ['从财', '从杀', '从儿', '从势', '专旺', '从强'] as const;
export const FY_RULES = [
  'Y-FY-W-SHA',
  'Y-FY-W-SHI',
  'Y-FY-W-CAI',
  'Y-FY-S-YIN',
  'Y-FY-S-BI-GUAN',
  'Y-FY-S-BI-SHI',
  'Y-CONG',
  'Y-ZHUANWANG',
] as const;
export const ROLES = ['用', '喜', '忌', '闲'] as const;
export const TIERS = ['顺势期', '向好', '平稳', '宜稳守', '宜保守、打基础'] as const;
export const TIER_GROUPS = ['好', '平', '守'] as const;
export const JISHEN_NAMES = ['天乙贵人', '月德贵人', '文昌贵人', '太极贵人'] as const;

export type FieldSpec =
  | { kind: 'enum'; domain: readonly string[]; nullable?: boolean }
  | { kind: 'bool' }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'list'; domain: readonly string[] }
  | { kind: 'objectList' }
  | { kind: 'text' };

const e = (domain: readonly string[], nullable = false): FieldSpec => ({
  kind: 'enum',
  domain,
  ...(nullable ? { nullable: true } : {}),
});
const BOOL: FieldSpec = { kind: 'bool' };
const PCT: FieldSpec = { kind: 'int', min: 0, max: 100 };
const list = (domain: readonly string[]): FieldSpec => ({ kind: 'list', domain });

/** §3.1 全局字段 */
export const GLOBAL_FIELDS: Readonly<Record<string, FieldSpec>> = {
  'profile.gender': e(['男', '女']),
  'profile.time_known': BOOL,
  'profile.confidence': e(['高', '中', '低']),
  'profile.current_age': { kind: 'int', min: 0, max: 150 },
  'profile.tst_status': e(['已校正', '未校正']),
  'profile.uncertain_year_month': BOOL,
  'day.stem': e(TIAN_GAN),
  'day.element': e(WUXING),
  'day.yinyang': e(['阳', '阴']),
  'month.branch': e(DI_ZHI),
  'month.season': e(['春', '夏', '秋', '冬']),
  'month.main_qi': e(TIAN_GAN),
  'month.main_god': e(GOD_GROUPS),
  ...Object.fromEntries(GOD_GROUPS.map((g) => [`el.${g}`, e(WUXING)])),
  'ten_gods.year_stem': e(TEN_GOD_NAMES),
  'ten_gods.month_stem': e(TEN_GOD_NAMES),
  'ten_gods.hour_stem': e(TEN_GOD_NAMES, true),
  'ten_gods.year_branch': e(TEN_GOD_NAMES),
  'ten_gods.month_branch': e(TEN_GOD_NAMES),
  'ten_gods.day_branch': e(TEN_GOD_NAMES),
  'ten_gods.hour_branch': e(TEN_GOD_NAMES, true),
  'ten_gods.persona': list(TEN_GOD_NAMES),
  'strength.level': e(STRENGTH_LEVELS),
  'strength.direction': e(['偏弱', '偏旺']),
  'strength.special': e(SPECIALS, true),
  'strength.borderline': BOOL,
  'strength.paradox': e(['得令却身弱', '失令却身旺'], true),
  'strength.S_pct': PCT,
  'strength.yidang_pct': PCT,
  'strength.de_ling': BOOL,
  'strength.de_di': BOOL,
  'strength.de_shi': { kind: 'int', min: 0, max: 3 },
  'strength.nohour_cong_possible': BOOL,
  'strength.nohour_cong_hours': list(DI_ZHI),
  ...Object.fromEntries(GOD_GROUPS.map((g) => [`gods.${g}_pct`, PCT])),
  'gods.top_yidang': e(['食伤', '财', '官杀']),
  'gods.top_tongdang': e(['比劫', '印']),
  'gods.top': e(GOD_GROUPS),
  'gods.top_yidang_pct': PCT,
  'gods.top_tongdang_pct': PCT,
  ...Object.fromEntries(WUXING.map((w) => [`power_pct.${w}`, PCT])),
  'yongshen.yong': e(WUXING),
  'yongshen.xi1': e(WUXING),
  'yongshen.ji1': e(WUXING),
  'yongshen.xi': list(WUXING),
  'yongshen.ji': list(WUXING),
  'yongshen.xian': list(WUXING),
  'yongshen.favorable': list(WUXING),
  'yongshen.yong_god': e(GOD_GROUPS),
  'yongshen.xi1_god': e(GOD_GROUPS),
  'yongshen.ji1_god': e(GOD_GROUPS),
  'yongshen.fy_rule': e(FY_RULES),
  'yongshen.swap': BOOL,
  'yongshen.swap_from': e(WUXING, true),
  'yongshen.swap_to': e(WUXING, true),
  'yongshen.swap_from_god': e(GOD_GROUPS, true),
  'yongshen.swap_to_god': e(GOD_GROUPS, true),
  'yongshen.th': e(['AGREE', 'NEUTRAL-OVERRIDE', 'ADD-XI'], true),
  'yongshen.th_element': e(WUXING, true),
  'yongshen.tg': BOOL,
  'yongshen.tg_element': e(WUXING, true),
  'career.mode': e(GOD_GROUPS),
  'partner.role': e(ROLES),
  'partner.pct': PCT,
  // Q5（2026-11-11）：CH7-WEALTH、CH5-PAST / CH5-FAR 的维度
  'wealth.role': e(ROLES),
  'wealth.level': e(['强', '中', '弱']),
  'dayun_summary.past_group': e(TIER_GROUPS, true),
  'dayun_summary.far_group': e(TIER_GROUPS, true),
  relations: { kind: 'objectList' },
  shensha: list(JISHEN_NAMES),
  shensha_first: e(JISHEN_NAMES, true),
};

/** §3.2 循环槽位的 item 字段 */
export const ITEM_FIELDS: Readonly<Record<string, FieldSpec>> = {
  'item.ganzhi': { kind: 'text' },
  'item.year': { kind: 'int', min: 1800, max: 2200 },
  'item.start_year': { kind: 'int', min: 1800, max: 2200 },
  'item.end_year': { kind: 'int', min: 1800, max: 2200 },
  'item.stem_ten_god': e(TEN_GOD_NAMES),
  'item.stem_god': e(GOD_GROUPS),
  'item.tier': e(TIERS),
  'item.tier_group': e(TIER_GROUPS),
  'item.stem_role': e(ROLES),
  'item.branch_role': e(ROLES),
  'item.relations': { kind: 'objectList' },
  'item.phase': e(['past', 'current', 'next', 'far']),
  'item.ten_god': e(TEN_GOD_NAMES),
  'item.god': e(GOD_GROUPS),
  'item.is_favorable': BOOL,
  'item.element': e(WUXING),
  'item.role': e(['用', '喜']),
};

export const ALL_FIELDS: Readonly<Record<string, FieldSpec>> = { ...GLOBAL_FIELDS, ...ITEM_FIELDS };

export function fieldSpec(path: string): FieldSpec | undefined {
  return Object.hasOwn(ALL_FIELDS, path) ? ALL_FIELDS[path] : undefined;
}

/** 占位符过滤器（README §3.3）：`|名` 把十神组数据名显示为读者名 */
export const GOD_DISPLAY_NAME: Readonly<Record<(typeof GOD_GROUPS)[number], string>> = {
  比劫: '比劫',
  印: '印星',
  食伤: '食伤',
  财: '财星',
  官杀: '官杀',
};
export const PLACEHOLDER_FILTERS = ['名'] as const;
