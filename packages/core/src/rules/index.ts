/**
 * ② 规则引擎（纯函数）：strength / yongshen / shensha / 评分 / 三柱扫描。
 */
export type * from './types';
export { RULE_IDS, RULE_ID_PREFIX_FILES, isRuleId, ruleIdPrefix } from './rule-ids';
export type { RuleId, RuleIdPrefix } from './rule-ids';
export { ruleHit, formatRuleHit } from './rule-hit';
export type { RuleHit, RuleEvidence, RuleEvidenceValue } from './rule-hit';
export {
  RULE_IMPLEMENTATIONS,
  PENDING_RULES,
  DOC_ONLY_RULES,
  ruleStatus,
  type DocOnlyRule,
  type PendingRule,
  type RuleImplementation,
  type RuleStatus,
  type TaskId,
} from './registry';
export {
  POSITION_WEIGHTS,
  HIDDEN_STEMS,
  ROOTLESS_STEM_FACTOR,
  ROOT_MIN_RATIO,
  COMBOS,
  DISPLAY_DAY_MASTER_BONUS,
  LEVEL_THRESHOLDS,
  CONG_MAX_S,
  CONG_DOMINANT_SHARE,
  ZHUANWANG_MIN_S,
  ZHUANWANG_MAX_GUANSHA_SHARE,
  ZHUANWANG_MAX_CAI_SHARE,
  BORDERLINE_DELTA,
  type PillarPosition,
  type ComboDef,
  type ComboKind,
} from './params';
export {
  computeStrengthPower,
  godGroupOf,
  elementOfGroup,
  WUXING_ORDER,
  GOD_GROUP_ORDER,
  type StrengthPower,
  type StemScore,
  type ComboHit,
} from './strength-power';
export {
  computeStrength,
  computeStrengthLevel,
  checkCong,
  checkZhuanwang,
  congSpecialOf,
  zhuanwangSpecialOf,
  ordinaryLevel,
  isBorderline,
  levelDirection,
  ZHUANWANG_NAMES,
  NOTE_NOHOUR_NO_SPECIAL,
  type Strength,
  type StrengthLevelResult,
  type CongCheck,
  type ZhuanwangCheck,
} from './strength-level';
export { RULES_FILES, RULES_VERSION } from './version';
