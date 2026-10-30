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
};

export const PENDING_RULES: Readonly<Partial<Record<RuleId, PendingRule>>> = {
  // strength.md
  'S-POWER': { task: 'T15', note: '五行力量计分（位置权重常量已在 rules/params.ts 定义并比对）' },
  'S-ROOT': { task: 'T15', note: '天干无根 × 0.6' },
  'S-COMBO': { task: 'T15', note: '三会 +2.0 / 三合 +1.5' },
  'S-LEVEL': { task: 'T16', note: '旺衰等级（按顺序命中即停）' },
  'S-CONG': { task: 'T16', note: '从弱只认真从（5 条全满足）及子类型' },
  'S-ZHUANWANG': { task: 'T16', note: '专旺 / 从强' },
  'S-NOHOUR': { task: 'T18', note: '三柱 13 时柱扫描与置信度' },
  // yongshen.md
  'Y-CONG': { task: 'T17', note: '从弱格喜忌' },
  'Y-ZHUANWANG': { task: 'T17', note: '专旺 / 从强格喜忌' },
  'Y-FY-W-SHA': { task: 'T17', note: '扶抑：身弱、官杀最强' },
  'Y-FY-W-SHI': { task: 'T17', note: '扶抑：身弱、食伤最强' },
  'Y-FY-W-CAI': { task: 'T17', note: '扶抑：身弱、财最强' },
  'Y-FY-S-YIN': { task: 'T17', note: '扶抑：身旺、印最强' },
  'Y-FY-S-BI-GUAN': { task: 'T17', note: '扶抑：身旺、比劫最强且官杀 ≥ 1.0' },
  'Y-FY-S-BI-SHI': { task: 'T17', note: '扶抑：身旺、比劫最强且官杀 < 1.0' },
  'Y-SWAP': { task: 'T17', note: '用神缺位互换' },
  'Y-TH-AGREE': { task: 'T17', note: '调候与扶抑一致' },
  'Y-TH-NEUTRAL-OVERRIDE': { task: 'T17', note: '中和命局调候接管用神' },
  'Y-TH-ADD-XI': { task: 'T17', note: '身弱 / 身旺调候追加喜神' },
  'Y-TG': { task: 'T17', note: '通关（方向一致才采用）' },
  // shensha.md
  'SS-SCOPE': {
    task: 'T19',
    note: '总原则：吉神不参与任何判定（由 T19 的解耦回归测试与评分输入类型落实）',
  },
  'SS-TIANYI': { task: 'T19', note: '天乙贵人表' },
  'SS-TAIJI': { task: 'T19', note: '太极贵人表' },
  'SS-WENCHANG': { task: 'T19', note: '文昌贵人表' },
  'SS-YUEDE': { task: 'T19', note: '月德贵人表' },
  'SS-OUTPUT': { task: 'T19', note: '去重、by 合并、固定顺序、jishen_display' },
  'SS-DISPLAY': { task: 'T31', note: '吉神只在付费报告第 0 章小表、第 3 章 CH3-SHENSHA 出现' },
  'SS-WORDING': {
    task: 'T33',
    note: '释义常量随第 0 章小表在 T31 落地；禁用表述并入 R-CHECK 禁用词表，在 T33 完成',
  },
  // report-sections.md
  'R-YUN-SCORE': { task: 'T20', note: '大运评分与 tier' },
  'R-LN-SCORE': { task: 'T20', note: '流年评分与 tier' },
  'R-SLOT': { task: 'T22', note: '槽位注册表 slots.ts 与 md 表格比对' },
  'R-CTX': { task: 'T28', note: '拼装上下文 ctx（T27 基础字段、T28 其余字段）' },
  'R-PERSONA': { task: 'T28', note: 'ten_gods.persona 选取顺序' },
  'R-SEC': { task: 'T32', note: '章节与篇幅（assembleReport）' },
  'R-NOHOUR': { task: 'T32', note: '三柱槽位降级（T31 第 0–4 章、T32 第 5–8 章）' },
  'R-CHECK': { task: 'T33', note: '成品自动校验' },
  'R-COVER': { task: 'T35', note: '覆盖率（T34 静态穷举、T35 动态抽样）' },
  'R-POLISH': { task: 'T36', note: '润色接口，默认关闭' },
  'R-FREE': { task: 'T43', note: '免费结果页 4 个模块（代码模板）' },
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
