/**
 * 规则引擎输出类型（T03 初版，只含 cases.json 对照所需字段）。
 * T15–T20 逐步补全（power_display_pct、confidence、notes、basis、评分等）。
 */
import type { RuleHit } from './rule-hit';

export type WuXing = '木' | '火' | '土' | '金' | '水';
export type GodGroup = '比劫' | '印' | '食伤' | '财' | '官杀';

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

export interface Analysis {
  strength: {
    S: number;
    /** strength.md S-LEVEL 的等级文字（身旺 / 中和 / 身弱 / 从弱 / 从强 等，T16 收窄为字面量联合） */
    level: string;
    special: string | null;
    de_ling: boolean;
    de_di: boolean;
    de_shi: number;
    power: Record<WuXing, number>;
    gods: Record<GodGroup, number>;
    borderline: boolean;
  };
  yongshen: {
    yong: WuXing;
    xi: WuXing[];
    ji: WuXing[];
    xian: WuXing[];
  };
  shensha: {
    jishen: Jishen[];
  };
  /** 命中的 S- / Y- / SS- 规则（T14 起为 RuleHit 对象；cases.json 格式见 formatRuleHit） */
  rules_hit: readonly RuleHit[];
}
