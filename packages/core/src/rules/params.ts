/**
 * strength.md 中以 JSON 参数块给出的计分参数（代码常量）。
 *
 * - S-HIDE 地支藏干比例：与命盘表共用 bazi/ten-gods.ts 的 HIDDEN_STEMS（ARCHITECTURE §3.3：计分与展示用同一张表），
 *   这里只做转出，不另抄一份。
 * - 位置权重（strength.md §2.1，S-POWER 使用）：本文件定义，T15 计分直接引用。
 * - test/rules-params.test.ts 解析 strength.md 的 JSON 参数块与这些常量逐项比对（参数漂移测试），
 *   改动 rules/ 或这里任一边而不改另一边，测试即失败。
 */
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
