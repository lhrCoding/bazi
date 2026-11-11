/**
 * 规则引擎汇总入口 analyze(chart)（ARCHITECTURE §4.2；T17 落地）。
 *
 * 当前包含：旺衰（T15 / T16，strength.md §2–§4）→ 喜用神（T17，yongshen.md）。
 * 后续任务在此追加：三柱扫描与置信度（T18）、吉神（T19，不进入旺衰 / 喜忌的任何输入）、大运 / 流年评分（T20）。
 * 纯函数：同样的 Chart 永远得到同样的 Analysis。
 */
import type { Zhi } from '../bazi/ganzhi';
import type { Chart } from '../bazi/types';
import { computeStrength } from './strength-level';
import type { Analysis } from './types';
import { computeYongshen } from './yongshen';

export function analyze(chart: Pick<Chart, 'pillars'>): Analysis {
  const strength = computeStrength(chart.pillars);
  const yongshen = computeYongshen(strength, chart.pillars.month[1] as Zhi);
  return {
    strength,
    yongshen,
    notes: [...strength.notes, ...yongshen.notes],
    rules_hit: [...strength.rules_hit, ...yongshen.rules_hit],
  };
}
