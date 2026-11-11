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
export {
  computeYongshen,
  fuyi,
  rankAliens,
  tongguanPair,
  wuxingKe,
  wuxingSheng,
  SPECIAL_PICKS,
  WEAK_ALIEN_PRIORITY,
  TIAOHOU_NEED,
  FY_GUANSHA_MIN,
  SWAP_XI_MIN,
  TH_MAX_SHARE,
  TG_MIN_SHARE,
  type Yongshen,
  type YongshenStrengthInput,
  type FyRule,
  type FyRuleId,
  type FuyiResult,
  type GroupPick,
  type TiaohouKind,
  type TongguanCheck,
} from './yongshen';
export {
  computeNoHourScan,
  confidenceOf,
  scanHourPillars,
  NOHOUR_SCAN_SLOTS,
  CONF_HIGH_DIRECTION_MIN,
  CONF_HIGH_YONG_MIN,
  CONF_MID_DIRECTION_MIN,
  type Confidence,
  type NoHourAlt,
  type NoHourScan,
  type NoHourSlot,
} from './nohour';
export {
  computeJishen,
  computeShensha,
  intersectJishen,
  JISHEN_ORDER,
  TAIJI,
  TIANYI,
  WENCHANG,
  YUEDE,
  type Shensha,
} from './shensha';
export { analyze } from './analyze';
export { RULES_FILES, RULES_VERSION } from './version';
