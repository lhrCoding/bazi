/**
 * 排盘引擎输入 / 输出类型（T13 定稿）：全部由 schema.ts 的 Zod schema 推导，类型与运行时校验同源。
 * 字段说明见 schema.ts。
 */
import type { z } from 'zod';
import type {
  BirthInputSchema,
  CalRuleIdSchema,
  ChartSchema,
  ClockToUtcSchema,
  DayunSchema,
  DayunStepSchema,
  GenderSchema,
  HiddenStemSchema,
  JieqiChoiceSchema,
  JieqiMomentSchema,
  LiunianYearSchema,
  PillarsSchema,
  QiyunOffsetSchema,
  TrueSolarTimeSchema,
  TstStatusSchema,
} from './schema';

export type Gender = z.infer<typeof GenderSchema>;

/** 交节日且不知道时辰时，用户对「出生在交节前 / 后」的选择（CAL-NOHOUR）。 */
export type JieqiChoice = z.infer<typeof JieqiChoiceSchema>;

export type BirthInput = z.infer<typeof BirthInputSchema>;

export type Pillars = z.infer<typeof PillarsSchema>;

export type PillarPos = keyof Pillars;

/** 节气（名称 + 北京时间精确时刻 'YYYY-MM-DD HH:MM:SS'）。 */
export type JieqiMoment = z.infer<typeof JieqiMomentSchema>;

/** CAL-TZ：本地钟表时间 → UTC。 */
export type ClockToUtc = z.infer<typeof ClockToUtcSchema>;

/** CAL-TST：真太阳时。 */
export type TrueSolarTime = z.infer<typeof TrueSolarTimeSchema>;

export type TstStatus = z.infer<typeof TstStatusSchema>;

export type HiddenStem = z.infer<typeof HiddenStemSchema>;

export type DayunStep = z.infer<typeof DayunStepSchema>;

/** 起运间隔（CAL-YUN，按分钟折算，精确到 2 小时）。 */
export type QiyunOffset = z.infer<typeof QiyunOffsetSchema>;

export type Dayun = z.infer<typeof DayunSchema>;

export type LiunianYear = z.infer<typeof LiunianYearSchema>;

export type CalRuleId = z.infer<typeof CalRuleIdSchema>;

export type Chart = z.infer<typeof ChartSchema>;
