/**
 * 规则引擎汇总入口 analyze(chart)（ARCHITECTURE §4.2；T17 落地）。
 *
 * 当前包含：旺衰（T15 / T16，strength.md §2–§4）→ 喜用神（T17，yongshen.md）→ 三柱扫描与置信度（T18，strength.md §5）。
 * → 吉神（T19，shensha.md；最后计算、只读 pillars，不进入旺衰 / 喜忌的任何输入）。
 * → 大运 / 流年评分（T20，report-sections.md §8；吉神不参与）。
 * 纯函数：同样的 Chart 永远得到同样的 Analysis。
 */
import type { Zhi } from '../bazi/ganzhi';
import type { Chart } from '../bazi/types';
import { computeNoHourScan } from './nohour';
import { computeScores } from './scoring';
import { computeShensha } from './shensha';
import { computeStrength } from './strength-level';
import type { Analysis } from './types';
import { computeYongshen } from './yongshen';

/** uncertain 缺省视为当天无交节（单元测试只给 pillars 时）。 */
export function analyze(
  chart: Pick<Chart, 'pillars'> & Partial<Pick<Chart, 'uncertain' | 'dayun' | 'liunian'>>,
): Analysis {
  const strength = computeStrength(chart.pillars);
  const yongshen = computeYongshen(strength, chart.pillars.month[1] as Zhi);
  const no_hour =
    chart.pillars.hour === null
      ? computeNoHourScan(
          {
            pillars: chart.pillars,
            uncertain: chart.uncertain ?? { month_pillar: null, jieqi_time: null },
          },
          { strength, yongshen },
        )
      : null;
  // R-YUN-SCORE / R-LN-SCORE：只传喜忌集合与柱、大运、流年（ScoringInput 不接受吉神）
  const scores =
    chart.dayun && chart.liunian
      ? computeScores({
          yongshen,
          pillars: chart.pillars,
          dayun: chart.dayun,
          liunian: chart.liunian,
        })
      : null;
  // SS-SCOPE：吉神放在所有判定之后，输入只有柱与交节信息
  const shensha = computeShensha(chart);
  return {
    strength,
    yongshen,
    confidence: no_hour?.confidence ?? '高',
    no_hour,
    shensha,
    scores,
    notes: [...strength.notes, ...yongshen.notes, ...(no_hour?.notes ?? [])],
    rules_hit: [
      ...strength.rules_hit,
      ...yongshen.rules_hit,
      ...(no_hour?.rules_hit ?? []),
      ...(scores?.rules_hit ?? []),
    ],
  };
}
