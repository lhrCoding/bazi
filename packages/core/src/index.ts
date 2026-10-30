/**
 * @zhiming/core 公开 API 入口。
 * 对外只暴露 ARCHITECTURE 第 4 节列出的少数函数（computeChart、analyze、buildCtx、
 * assembleReport、buildFreeResult、encodeBirth / decodeBirth / canonicalizeBirth、lintTexts、coverage*），
 * 以及它们的输入 / 输出 schema、类型与错误码。各函数在后续任务中逐个加入。
 */
export const CORE_PACKAGE = '@zhiming/core';

// ① 排盘（T13）
export { computeChart } from './bazi/chart';
export { ENGINE_VERSION } from './bazi/version';
export { BirthInputSchema, ChartSchema, CAL_RULE_IDS } from './bazi/schema';
export {
  BaziError,
  BAZI_ERROR_MESSAGES,
  baziErrorMessage,
  type BaziErrorCode,
} from './bazi/errors';
export type {
  BirthInput,
  CalRuleId,
  Chart,
  Dayun,
  DayunStep,
  Gender,
  HiddenStem,
  JieqiChoice,
  JieqiMoment,
  LiunianYear,
  Pillars,
  TstStatus,
} from './bazi/types';
