/**
 * 规则注册表（TASKS T14；ARCHITECTURE §4.2「规则与代码对应」）。
 *
 * rules/*.md 中的每个编号（RULE_IDS）必须**恰好**处于下面三种状态之一，由 test/rules-registry.test.ts 强制：
 *
 * 1. 已实现（RULE_IMPLEMENTATIONS）：登记实现所在模块并引用实现本身（函数或常量表）。
 *    删掉实现 → 编号不再属于任何状态 → 覆盖测试失败。
 * 2. 待实现（PENDING_RULES）：尚未实现，写明负责任务。测试要求该任务在 docs/TASKS.md 中存在且**未打勾**——
 *    任务打勾时若仍有编号挂在这里（忘了实现或忘了登记），测试失败。实现后把编号从这里移到 RULE_IMPLEMENTATIONS。
 * 3. 仅文档（DOC_ONLY_RULES）：md 中只作为统称 / 章节标题出现、本身没有独立判定逻辑的编号，逐条写明原因；
 *    covers 列出它统称的细分编号，测试要求这些细分编号本身不是「仅文档」（不能用白名单套白名单）。
 *
 * 新增实现的约定：实现模块里用 ruleHit(ruleId, …) 记录命中；在此把编号从 PENDING_RULES 移到 RULE_IMPLEMENTATIONS。
 */
import { computeChart } from '../bazi/chart';
import { CAL_RULE_IDS } from '../bazi/schema';
import { HIDDEN_STEMS } from '../bazi/ten-gods';
import type { RuleId } from './rule-ids';
import { checkCong, checkZhuanwang, computeStrengthLevel } from './strength-level';
import { computeStrengthPower } from './strength-power';
import { computeNoHourScan } from './nohour';
import { altPossibility, assembleReport, chapter0 } from '../report/assemble';
import { buildFreeResult } from '../report/free';
import { rcheck, SHENSHA_FORBIDDEN } from '../report/check';
import { polishReport } from '../report/polish';
import { runSample } from '../report/sample';
import { buildCtx, personaOf } from '../report/ctx';
import { SLOTS } from '../report/slots';
import { computeScores } from './scoring';
import { computeShensha, TAIJI, TIANYI, WENCHANG, YUEDE } from './shensha';
import { computeYongshen, fuyi, SPECIAL_PICKS, TIAOHOU_NEED, tongguanPair } from './yongshen';

/** docs/TASKS.md 的任务编号。 */
export type TaskId = `T${number}`;

export interface RuleImplementation {
  /** 实现所在模块（相对 packages/core/src） */
  readonly module: string;
  /** 实现本身（函数或参数表）；删掉实现时这里无法编译 / 取不到值 */
  readonly impl: unknown;
}

export interface PendingRule {
  readonly task: TaskId;
  readonly note: string;
}

export interface DocOnlyRule {
  readonly reason: string;
  /** 该编号统称的细分编号（必须是已实现或待实现） */
  readonly covers: readonly RuleId[];
}

// 编译期保证：排盘输出的 CAL 编号都在规则编号全集里。
const CAL_IDS: readonly RuleId[] = CAL_RULE_IDS;

export const RULE_IMPLEMENTATIONS: Readonly<Partial<Record<RuleId, RuleImplementation>>> = {
  // calendar.md：排盘引擎（T04–T13）。每个编号都会写进 Chart.rules_hit，测试用 cases.json 实跑确认全部出现过。
  ...Object.fromEntries(
    CAL_IDS.map((id) => [id, { module: 'bazi/chart.ts（computeChart）', impl: computeChart }]),
  ),
  // strength.md §1.2：藏干比例表，排盘（藏干、十神）与计分共用；与 md JSON 参数块的比对见 rules-params.test.ts。
  'S-HIDE': { module: 'bazi/ten-gods.ts（HIDDEN_STEMS）', impl: HIDDEN_STEMS },
  // strength.md §2–§3、§6（T15）：五行力量、十神分组、S、得令 / 得地 / 得势、power_display_pct。
  'S-POWER': {
    module: 'rules/strength-power.ts（computeStrengthPower）',
    impl: computeStrengthPower,
  },
  'S-ROOT': {
    module: 'rules/strength-power.ts（computeStrengthPower；系数 ROOTLESS_STEM_FACTOR）',
    impl: computeStrengthPower,
  },
  'S-COMBO': {
    module: 'rules/strength-power.ts（computeStrengthPower；合局表 COMBOS）',
    impl: computeStrengthPower,
  },
  // strength.md §4（T16）：旺衰等级（按顺序命中即停）、从弱只认真从、专旺 / 从强；三柱不判特殊格局。
  'S-LEVEL': {
    module: 'rules/strength-level.ts（computeStrengthLevel；阈值 LEVEL_THRESHOLDS）',
    impl: computeStrengthLevel,
  },
  'S-CONG': {
    module: 'rules/strength-level.ts（checkCong / congSpecialOf）',
    impl: checkCong,
  },
  'S-ZHUANWANG': {
    module: 'rules/strength-level.ts（checkZhuanwang / zhuanwangSpecialOf）',
    impl: checkZhuanwang,
  },
  // yongshen.md（T17）：判定顺序 格局 → 扶抑 → 互换 → 调候 → 通关 → 闲神，全部在 computeYongshen 中按顺序执行。
  'Y-CONG': {
    module: 'rules/yongshen.ts（computeYongshen；从弱表 SPECIAL_PICKS）',
    impl: SPECIAL_PICKS,
  },
  'Y-ZHUANWANG': {
    module: 'rules/yongshen.ts（computeYongshen；专旺 / 从强表 SPECIAL_PICKS）',
    impl: SPECIAL_PICKS,
  },
  'Y-FY-W-SHA': { module: 'rules/yongshen.ts（fuyi）', impl: fuyi },
  'Y-FY-W-SHI': { module: 'rules/yongshen.ts（fuyi）', impl: fuyi },
  'Y-FY-W-CAI': { module: 'rules/yongshen.ts（fuyi）', impl: fuyi },
  'Y-FY-S-YIN': { module: 'rules/yongshen.ts（fuyi）', impl: fuyi },
  'Y-FY-S-BI-GUAN': { module: 'rules/yongshen.ts（fuyi；阈值 FY_GUANSHA_MIN）', impl: fuyi },
  'Y-FY-S-BI-SHI': { module: 'rules/yongshen.ts（fuyi；阈值 FY_GUANSHA_MIN）', impl: fuyi },
  'Y-SWAP': {
    module: 'rules/yongshen.ts（computeYongshen ③；阈值 SWAP_XI_MIN）',
    impl: computeYongshen,
  },
  'Y-TH-AGREE': {
    module: 'rules/yongshen.ts（computeYongshen ④；TIAOHOU_NEED / TH_MAX_SHARE）',
    impl: TIAOHOU_NEED,
  },
  'Y-TH-NEUTRAL-OVERRIDE': {
    module: 'rules/yongshen.ts（computeYongshen ④；v1.1 原用神保留为第一喜神）',
    impl: computeYongshen,
  },
  'Y-TH-ADD-XI': { module: 'rules/yongshen.ts（computeYongshen ④）', impl: computeYongshen },
  'Y-TG': { module: 'rules/yongshen.ts（tongguanPair / computeYongshen ⑤）', impl: tongguanPair },
  // shensha.md（T19）：吉神只展示，analyze 最后计算、只读柱（解耦回归测试见 shensha.test.ts）
  'SS-SCOPE': { module: 'rules/analyze.ts（computeShensha 在所有判定之后）', impl: computeShensha },
  'SS-TIANYI': { module: 'rules/shensha.ts（TIANYI）', impl: TIANYI },
  'SS-TAIJI': { module: 'rules/shensha.ts（TAIJI）', impl: TAIJI },
  'SS-WENCHANG': { module: 'rules/shensha.ts（WENCHANG）', impl: WENCHANG },
  'SS-YUEDE': { module: 'rules/shensha.ts（YUEDE）', impl: YUEDE },
  'SS-OUTPUT': {
    module:
      'rules/shensha.ts（computeJishen 去重 / by 合并 / 固定顺序；computeShensha jishen_display）',
    impl: computeShensha,
  },
  // shensha.md §4（T31 释义常量 JISHEN_NOTES；T33 禁用表述并入 R-CHECK）
  'SS-WORDING': {
    module: 'report/check.ts（SHENSHA_FORBIDDEN）、report/assemble.ts（JISHEN_NOTES）',
    impl: SHENSHA_FORBIDDEN,
  },
  // report-sections.md §1（T43）：免费结果页 4 个模块，句式为代码模板（texts/free.yaml 未写）
  'R-FREE': {
    module: 'report/free.ts（buildFreeResult，FREE_RESULT_KEYS 白名单）',
    impl: buildFreeResult,
  },
  // report-sections.md §9（T36）：润色接口默认关闭，MVP 只有 NoopPolisher；校验与超时已实现
  'R-POLISH': {
    module: 'report/polish.ts（createPolisher / polishReport / validatePolish）',
    impl: polishReport,
  },
  // report-sections.md §5（T34 静态穷举、T35 动态抽样）
  'R-COVER': {
    module: 'texts/coverage.ts（computeCoverage）、report/sample.ts（runSample）',
    impl: runSample,
  },
  // report-sections.md §7（T33）：成品检查，生产告警放行、测试失败
  'R-CHECK': { module: 'report/check.ts（rcheck / assertRCheck）', impl: rcheck },
  // report-sections.md §2 / §4（T31 / T32）：章节顺序与三柱降级（字数校验见 R-CHECK）
  'R-SEC': { module: 'report/assemble.ts（assembleReport：第 0–8 章）', impl: assembleReport },
  'R-NOHOUR': {
    module: 'report/assemble.ts（三柱缺失说明、替换条目、另一种可能句、不算冲时支）',
    impl: altPossibility,
  },
  // shensha.md §3（T31）：吉神只在第 0 章小表与第 3 章 CH3-SHENSHA（assemble-0-4.test.ts 对 20 个案例检查）
  'SS-DISPLAY': {
    module: 'report/assemble.ts（chapter0 吉神小表、chapter3 CH3-SHENSHA）',
    impl: chapter0,
  },
  // report-sections.md §0 / §6（T27 / T28）：ctx 构造与 persona 选取
  'R-CTX': {
    module: 'report/ctx.ts（buildCtxBase / buildCtx；ctxProblems 按字段字典校验）',
    impl: buildCtx,
  },
  'R-PERSONA': { module: 'report/ctx.ts（personaOf）', impl: personaOf },
  // report-sections.md §3（T22）：槽位注册表，test/slots.test.ts 与 md 表格逐字段比对
  'R-SLOT': { module: 'report/slots.ts（SLOTS）', impl: SLOTS },
  // report-sections.md §8（T20）
  'R-YUN-SCORE': {
    module: 'rules/scoring.ts（elementScores / ganzhiScore / tierOf）',
    impl: computeScores,
  },
  'R-LN-SCORE': {
    module: 'rules/scoring.ts（liunianRelations / computeScores）',
    impl: computeScores,
  },
  // strength.md §5（T18）
  'S-NOHOUR': {
    module: 'rules/nohour.ts（computeNoHourScan；13 时柱 scanHourPillars、置信度 confidenceOf）',
    impl: computeNoHourScan,
  },
};

export const PENDING_RULES: Readonly<Partial<Record<RuleId, PendingRule>>> = {
  // shensha.md
  // report-sections.md
};

export const DOC_ONLY_RULES: Readonly<Partial<Record<RuleId, DocOnlyRule>>> = {
  'CAL-YM': {
    reason:
      'calendar.md §0 流程总览第 ③ 步对年柱（§1 CAL-YM-1）与月柱（§2 CAL-YM-2）两条规则的统称，本身没有独立判定；' +
      '排盘按细分编号实现并在 Chart.rules_hit 中记录 CAL-YM-1 / CAL-YM-2。',
    covers: ['CAL-YM-1', 'CAL-YM-2'],
  },
  'Y-FY': {
    reason:
      'yongshen.md §3「扶抑」的章节编号，是 6 条扶抑子规则（表格「规则」列）的统称，本身没有独立判定；' +
      '命中时只记录具体子编号（cases.json rules_hit_expected 也只用子编号）。',
    covers: [
      'Y-FY-W-SHA',
      'Y-FY-W-SHI',
      'Y-FY-W-CAI',
      'Y-FY-S-YIN',
      'Y-FY-S-BI-GUAN',
      'Y-FY-S-BI-SHI',
    ],
  },
  'Y-TH': {
    reason:
      'yongshen.md §4「调候修正」的章节编号，统称 AGREE / NEUTRAL-OVERRIDE / ADD-XI 三种处理（report-sections.md 写作「Y-TH-*」）；' +
      '触发条件属于这三条子规则的公共前提，命中时只记录具体子编号。',
    covers: ['Y-TH-AGREE', 'Y-TH-NEUTRAL-OVERRIDE', 'Y-TH-ADD-XI'],
  },
};

export type RuleStatus =
  | { readonly status: 'implemented'; readonly implementation: RuleImplementation }
  | { readonly status: 'pending'; readonly pending: PendingRule }
  | { readonly status: 'doc-only'; readonly docOnly: DocOnlyRule };

/**
 * 编号的状态。同一编号登记在多处或一处都没有时返回 null（属于注册表缺陷，覆盖测试会报出）。
 */
export function ruleStatus(id: RuleId): RuleStatus | null {
  const found: RuleStatus[] = [];
  const impl = RULE_IMPLEMENTATIONS[id];
  const pending = PENDING_RULES[id];
  const docOnly = DOC_ONLY_RULES[id];
  if (impl) found.push({ status: 'implemented', implementation: impl });
  if (pending) found.push({ status: 'pending', pending });
  if (docOnly) found.push({ status: 'doc-only', docOnly });
  return found.length === 1 ? (found[0] as RuleStatus) : null;
}
