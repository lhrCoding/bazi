/**
 * 规则引擎输出类型。
 */
import type { RuleHit } from './rule-hit';
import type { Strength } from './strength-level';
import type { Yongshen } from './yongshen';
import type { Confidence, NoHourScan } from './nohour';
import type { Scores } from './scoring';
import type { Shensha } from './shensha';

export type WuXing = '木' | '火' | '土' | '金' | '水';
export type GodGroup = '比劫' | '印' | '食伤' | '财' | '官杀';

/** strength.md §4（S-LEVEL）的 6 个等级。 */
export type StrengthLevel = '身旺' | '中和偏旺' | '中和偏弱' | '身弱' | '从弱' | '从强';
/** strength.md §4.1（S-CONG）从弱子类型。 */
export type CongSpecial = '从财' | '从杀' | '从儿' | '从势';
/** strength.md §4.2（S-ZHUANWANG）专旺 / 从强子类型。 */
export type ZhuanwangSpecial = '专旺' | '从强';
export type SpecialPattern = CongSpecial | ZhuanwangSpecial;
/** strength.md §5 第 2 条：偏弱组 = 身弱 / 中和偏弱 / 从弱；偏旺组 = 身旺 / 中和偏旺 / 从强。 */
export type StrengthDirection = '偏弱' | '偏旺';

/** 吉神名称，输出顺序固定（shensha.md）。 */
export type JishenName = '天乙贵人' | '月德贵人' | '文昌贵人' | '太极贵人';
export type ShenshaPos = '年干' | '年支' | '月干' | '月支' | '日干' | '日支' | '时干' | '时支';
export type ShenshaBy = '日干' | '年干' | '月支';

export interface JishenHit {
  pos: ShenshaPos;
  by: ShenshaBy[];
}

export interface Jishen {
  name: JishenName;
  hits: JishenHit[];
}

/**
 * analyze(chart) 的输出（ARCHITECTURE §4.2）。T17 起包含旺衰与喜用神，T18 起包含三柱扫描与置信度，T19 起包含吉神，T20 起包含大运 / 流年评分；
 */
export interface Analysis {
  /** 旺衰（strength.md §2–§4、§6） */
  strength: Strength;
  /** 喜用神（yongshen.md） */
  yongshen: Yongshen;
  /**
   * 结论置信度（strength.md §5 第 3、5 条）。知道时辰恒为「高」（正常显示）；三柱取 no_hour.confidence。
   */
  confidence: Confidence;
  /** 三柱时辰扫描（S-NOHOUR，T18）；知道时辰为 null */
  no_hour: NoHourScan | null;
  /** 吉神（shensha.md，T19）：只做展示，不参与任何判定（SS-SCOPE） */
  shensha: Shensha;
  /**
   * 大运 / 流年评分（report-sections.md §8，T20）。只由喜忌集合与柱、大运、流年计算，吉神不参与。
   * 传入的 chart 不含 dayun / liunian（单元测试只给 pillars）时为 null。
   */
  scores: Scores | null;
  /** strength、yongshen、no_hour 的 notes 依次合并 */
  notes: string[];
  /** 命中的 S- / Y- 规则，按判定顺序（cases.json 格式见 formatRuleHit） */
  rules_hit: readonly RuleHit[];
}
