/**
 * strength.md 中以 JSON 参数块给出的计分参数（代码常量）。
 *
 * - S-HIDE 地支藏干比例：与命盘表共用 bazi/ten-gods.ts 的 HIDDEN_STEMS（ARCHITECTURE §3.3：计分与展示用同一张表），
 *   这里只做转出，不另抄一份。
 * - 位置权重（strength.md §2.1，S-POWER 使用）：本文件定义，T15 计分直接引用。
 * - test/rules-params.test.ts 解析 strength.md 的 JSON 参数块与这些常量逐项比对（参数漂移测试），
 *   改动 rules/ 或这里任一边而不改另一边，测试即失败。
 */
import type { Zhi } from '../bazi/ganzhi';
import type { WuXingName } from '../bazi/ten-gods';

export { HIDDEN_STEMS } from '../bazi/ten-gods';

export type PillarPosition = 'year' | 'month' | 'day' | 'hour';

/** strength.md §2.1 位置权重。日干本身不计分（day = 0）。 */
export const POSITION_WEIGHTS: {
  readonly stem: Readonly<Record<PillarPosition, number>>;
  readonly branch: Readonly<Record<PillarPosition, number>>;
} = {
  stem: { year: 0.8, month: 1.0, day: 0, hour: 1.0 },
  branch: { year: 0.8, month: 3.0, day: 1.5, hour: 1.0 },
};

/** strength.md §2.2 ①（S-ROOT）：天干五行在全部地支藏干（含余气）中都不出现时，位置权重 × 0.6。 */
export const ROOTLESS_STEM_FACTOR = 0.6;

/** strength.md §1.2：「有根」只认本气、中气（比例 ≥ 0.3），余气（0.1）不算。用于 de_di 等。 */
export const ROOT_MIN_RATIO = 0.3;

export type ComboKind = '三会' | '三合';

export interface ComboDef {
  readonly kind: ComboKind;
  /** 三个地支，按 strength.md 书写顺序 */
  readonly branches: readonly [Zhi, Zhi, Zhi];
  readonly element: WuXingName;
  readonly bonus: number;
}

/**
 * strength.md §2.2 ③（S-COMBO）：三支全见才加分（位置不限），不做化气替换；三会、三合可同时成立，各加各的。
 * 顺序即 md 中的书写顺序（三会在前），也是 rules_hit 的输出顺序。test/rules-params.test.ts 解析 md 正文比对。
 */
export const COMBOS: readonly ComboDef[] = [
  { kind: '三会', branches: ['寅', '卯', '辰'], element: '木', bonus: 2.0 },
  { kind: '三会', branches: ['巳', '午', '未'], element: '火', bonus: 2.0 },
  { kind: '三会', branches: ['申', '酉', '戌'], element: '金', bonus: 2.0 },
  { kind: '三会', branches: ['亥', '子', '丑'], element: '水', bonus: 2.0 },
  { kind: '三合', branches: ['申', '子', '辰'], element: '水', bonus: 1.5 },
  { kind: '三合', branches: ['亥', '卯', '未'], element: '木', bonus: 1.5 },
  { kind: '三合', branches: ['寅', '午', '戌'], element: '火', bonus: 1.5 },
  { kind: '三合', branches: ['巳', '酉', '丑'], element: '金', bonus: 1.5 },
];

/** strength.md §6：展示用数据 = power + 日干五行加 1.0，再归一到 100%。 */
export const DISPLAY_DAY_MASTER_BONUS = 1.0;
