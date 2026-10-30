/**
 * 规则命中记录 RuleHit（TASKS T14；ARCHITECTURE §4.2）。
 *
 * - ruleId：与 rules/*.md 中的编号逐字相同（RuleId 联合类型，见 rule-ids.ts）。
 * - text：命中说明的简短文字，对应 cases.json `rules_hit_expected` 中冒号后的部分
 *   （如 "S-COMBO:三合寅午戌火+1.5" 的「三合寅午戌火+1.5」、"S-LEVEL:身旺" 的「身旺」）；无需说明时为空串。
 * - evidence：触发该规则的结构化依据（参与判断的数值、阈值、柱位等），只放 JSON 可序列化的标量 / 数组 / 对象，
 *   供报告「依据」模板、差异清单（T21）和调试使用；不得放出生日期等原始输入。
 * - formatRuleHit 把 RuleHit 还原成 cases.json 的字符串格式，cases 对照按冒号前编号比对。
 */
import { isRuleId, type RuleId } from './rule-ids';

export type RuleEvidenceValue =
  | string
  | number
  | boolean
  | null
  | readonly RuleEvidenceValue[]
  | { readonly [key: string]: RuleEvidenceValue };

export type RuleEvidence = { readonly [key: string]: RuleEvidenceValue };

export interface RuleHit {
  readonly ruleId: RuleId;
  readonly text: string;
  readonly evidence: RuleEvidence;
}

/** 构造 RuleHit；运行时再确认一次编号已登记（防止 as 强转绕过类型检查）。 */
export function ruleHit(ruleId: RuleId, text = '', evidence: RuleEvidence = {}): RuleHit {
  if (!isRuleId(ruleId)) {
    throw new Error('规则命中使用了 rules/ 中不存在的编号');
  }
  if (text.includes(':')) {
    throw new Error('RuleHit.text 不得含半角冒号（冒号用于分隔编号与说明）');
  }
  return { ruleId, text, evidence };
}

/** "编号" 或 "编号:说明"（cases.json rules_hit_expected 的格式）。 */
export function formatRuleHit(hit: RuleHit): string {
  return hit.text === '' ? hit.ruleId : `${hit.ruleId}:${hit.text}`;
}
