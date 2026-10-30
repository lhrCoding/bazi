/**
 * 排盘引擎输入 / 输出的 Zod schema（T13 定稿）。字段按 ARCHITECTURE §4.1 与 rules/calendar.md §9。
 *
 * - BirthInputSchema：computeChart 的输入校验（严格对象，多余字段视为错误）。校验失败由 computeChart
 *   映射为错误码 E_INVALID_INPUT，绝不把 Zod 的错误信息（会带上收到的值）往外抛。
 * - ChartSchema：排盘输出。computeChart 每次返回前都用它校验一遍（严格对象，防止多出未声明的字段），
 *   并校验字段之间的一致性（三柱模式、真太阳时状态等）。
 * - 全部字段 JSON 可序列化：时刻一律用字符串或 Unix 毫秒整数，不用 Date 对象。
 * - types.ts 中的类型由这里的 schema 推导（z.infer），类型与运行时校验同源。
 *
 * 修改任何字段的含义或取值都会改变排盘输出，必须同时提升 ENGINE_VERSION（见 version.ts 与快照测试）。
 */
import { z } from 'zod';
import { isGanZhi, TIAN_GAN, type GanZhi } from './ganzhi';
import { TEN_GOD_NAMES } from './ten-gods';

// ---------- 基础 ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
/** 北京标准时间 'YYYY-MM-DD HH:MM:SS' */
const BJ_SECOND_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** 'YYYY-MM-DD HH:MM' */
const MINUTE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export const GanSchema = z.enum(TIAN_GAN);
export const GanZhiSchema = z.custom<GanZhi>(
  (v) => typeof v === 'string' && isGanZhi(v),
  '不是 60 甲子中的干支',
);
export const GenderSchema = z.enum(['男', '女']);
export const JieqiChoiceSchema = z.enum(['before', 'after', 'unsure']);
export const TenGodSchema = z.enum(TEN_GOD_NAMES);

/** 排盘输出中可能出现的 CAL 规则编号（rules/calendar.md），按判定流程排序。 */
export const CAL_RULE_IDS = [
  'CAL-INPUT',
  'CAL-TZ',
  'CAL-YM-1',
  'CAL-YM-2',
  'CAL-TST',
  'CAL-DH',
  'CAL-DH-ZI',
  'CAL-YUN',
  'CAL-NOHOUR',
] as const;
export const CalRuleIdSchema = z.enum(CAL_RULE_IDS);

// ---------- 输入 ----------

export const BirthInputSchema = z.strictObject({
  calendar: z.enum(['solar', 'lunar']),
  /** 'YYYY-MM-DD'；calendar = 'lunar' 时为农历年月日（月份不含闰字，闰月看 isLeapMonth）。 */
  date: z.string().regex(DATE_RE),
  /** 仅农历输入有意义：是否闰月。 */
  isLeapMonth: z.boolean().optional(),
  /** 本地钟表时间 'HH:MM'；不知道时辰为 null（三柱模式）。 */
  time: z.string().regex(TIME_RE).nullable(),
  gender: GenderSchema,
  /** 出生地代码（core/geo 表）；null = 未选出生地，不做真太阳时校正，时区默认 Asia/Shanghai。 */
  placeCode: z
    .string()
    .regex(/^[0-9A-Za-z_-]{1,32}$/)
    .nullable(),
  /** 交节日且不知道时辰时，用户对「出生在交节前 / 后」的选择（CAL-NOHOUR）；其余情况不起作用。 */
  jieqiChoice: JieqiChoiceSchema.nullable(),
});

// ---------- 输出 ----------

export const PillarsSchema = z.strictObject({
  year: GanZhiSchema,
  month: GanZhiSchema,
  day: GanZhiSchema,
  /** 三柱模式为 null。 */
  hour: GanZhiSchema.nullable(),
});

/** 节气（名称 + 北京标准时间精确时刻 'YYYY-MM-DD HH:MM:SS'）。 */
export const JieqiMomentSchema = z.strictObject({
  name: z.string().min(1),
  time: z.string().regex(BJ_SECOND_RE),
});

/** CAL-TZ：本地钟表时间 → UTC。 */
export const ClockToUtcSchema = z.strictObject({
  /** 'YYYY-MM-DDTHH:MM:SSZ' */
  utc: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  timezone: z.string().min(1),
  /** 出生时刻该时区相对 UTC 的偏移（分钟）。不一定是整数：tzdata 中 Asia/Shanghai 1901 年以前为地方平时 +8:05:43 */
  utcOffsetMinutes: z
    .number()
    .min(-24 * 60)
    .max(24 * 60),
  /** 夏令时结束日重复时刻：取较晚一次，并置此标记。 */
  dstAmbiguous: z.boolean(),
});

/** CAL-TST：真太阳时（仅选了出生地且知道时辰时存在）。 */
export const TrueSolarTimeSchema = z.strictObject({
  /** 北京时间 'YYYY-MM-DD HH:MM' */
  beijingTime: z.string().regex(MINUTE_RE),
  /** 真太阳时 'YYYY-MM-DD HH:MM' */
  trueSolarTime: z.string().regex(MINUTE_RE),
  longitudeCorrectionMin: z.number(),
  equationOfTimeMin: z.number(),
});

export const TstStatusSchema = z.enum(['已校正', '未校正']);

/** 一个藏干：天干、比例（strength.md S-HIDE）、相对日干的十神。 */
export const HiddenStemSchema = z.strictObject({
  gan: GanSchema,
  ratio: z.number().positive().max(1),
  ten_god: TenGodSchema,
});

export const DayunStepSchema = z.strictObject({
  ganzhi: GanZhiSchema,
  startYear: z.int(),
  endYear: z.int(),
  /** 对外展示用周岁 */
  startAge: z.int(),
  /** 内部保留虚岁 */
  startAgeXusui: z.int(),
});

/** 出生到相邻「节」的时间按 3 天 = 1 年折算后的起运间隔（CAL-YUN，按分钟折算，精确到 2 小时）。 */
export const QiyunOffsetSchema = z.strictObject({
  years: z.int().nonnegative(),
  months: z.int().min(0).max(11),
  days: z.int().min(0).max(29),
  hours: z.int().min(0).max(22),
});

export const DayunSchema = z.strictObject({
  direction: z.enum(['顺', '逆']),
  /** 起运间隔（出生 → 起运） */
  qiyunOffset: QiyunOffsetSchema,
  /** 起运时刻（北京标准时间 'YYYY-MM-DD HH:MM'） */
  qiyunTime: z.string().regex(MINUTE_RE),
  /** 起运日期 'YYYY-MM-DD' */
  qiyunDate: z.string().regex(DATE_RE),
  /** 起运时周岁（对外展示） */
  qiyunAge: z.int().nonnegative(),
  /** 三柱模式按 12:00 计算，标记「约 X 岁起运」 */
  approximate: z.boolean(),
  steps: z.array(DayunStepSchema).length(8),
});

export const LiunianYearSchema = z.strictObject({
  year: z.int(),
  ganzhi: GanZhiSchema,
  /** 当年立春时刻（北京标准时间 'YYYY-MM-DD HH:MM:SS'） */
  lichun: z.string().regex(BJ_SECOND_RE),
  /** 所在大运干支；尚未起运为 null */
  dayun: GanZhiSchema.nullable(),
});

const HiddenStemListSchema = z.array(HiddenStemSchema).min(1).max(3);

export const ChartSchema = z
  .strictObject({
    /** 排盘引擎版本（version.ts）；同版本同输入的输出永远相同 */
    engineVersion: z.string().min(1),
    /** 参考日期（Unix 毫秒）：流年起始年与所在大运由它决定。免费页 = 当前时间，付费报告 = 订单 createdAt */
    refDate: z.int(),
    /** 原样回显输入 */
    input_echo: BirthInputSchema,
    /** CAL-INPUT 换算后的公历出生日期 'YYYY-MM-DD'（公历输入即原日期） */
    solar_date: z.string().regex(DATE_RE),
    /** 是否知道时辰；false = 三柱模式（CAL-NOHOUR），时柱相关字段全部为 null */
    hourKnown: z.boolean(),
    pillars: PillarsSchema,
    /** 各柱藏干（S-HIDE 表，本气在前）；三柱模式 hour 为 null */
    hidden_stems: z.strictObject({
      year: HiddenStemListSchema,
      month: HiddenStemListSchema,
      day: HiddenStemListSchema,
      hour: HiddenStemListSchema.nullable(),
    }),
    /** 各柱天干相对日干的十神；日柱为「日主」，三柱模式 hour 为 null */
    ten_gods: z.strictObject({
      year: TenGodSchema,
      month: TenGodSchema,
      day: z.literal('日主'),
      hour: TenGodSchema.nullable(),
    }),
    /** CAL-TZ。三柱模式为实际计算时刻（默认当天 12:00 本地钟表时间）的换算 */
    clock_to_utc: ClockToUtcSchema,
    /** 仅「选了出生地且知道时辰」时存在 */
    true_solar_time: TrueSolarTimeSchema.nullable(),
    /** 已校正 = 选了出生地且知道时辰；其余（含三柱模式）为未校正 */
    tst_status: TstStatusSchema,
    /** 未校正且出生时刻离时辰边界（奇数整点）不足 30 分钟：结果页加提示句（CAL-TST，仅提示不改排盘）。已校正、三柱模式恒为 false */
    near_shichen_boundary: z.boolean(),
    /** 计算时刻之前最近的「节」 */
    jieqi_prev: JieqiMomentSchema,
    /** 计算时刻之后第一个「节」 */
    jieqi_next: JieqiMomentSchema,
    /** 三柱模式：出生日当天交接的「节」；当天无交节或知道时辰时为 null */
    jieqi_on_birthday: JieqiMomentSchema.nullable(),
    /** 三柱模式且当天有交节：实际采用的一侧（用户选择，或 unsure / null 时按 12:00 所在一侧）；其余为 null */
    jieqi_side: z.enum(['before', 'after']).nullable(),
    alt: z.strictObject({
      /** 23:00 换日派（不采用）的日柱，仅 23:00–23:59 出生时与主结果不同 */
      zi_huanri_day_pillar: GanZhiSchema,
    }),
    uncertain: z.strictObject({
      /** 交节日无时辰且未选前后：[交节前年月柱, 交节后年月柱] */
      month_pillar: z
        .tuple([z.tuple([GanZhiSchema, GanZhiSchema]), z.tuple([GanZhiSchema, GanZhiSchema])])
        .nullable(),
      /** 对应的交节时刻（北京标准时间） */
      jieqi_time: z.string().regex(BJ_SECOND_RE).nullable(),
    }),
    dayun: DayunSchema,
    /** 从 refDate 所在干支年起连续 5 年 */
    liunian: z.array(LiunianYearSchema).length(5),
    /** 命中的 CAL 编号（去重，按 CAL_RULE_IDS 顺序） */
    rules_hit: z.array(CalRuleIdSchema).min(1),
  })
  .superRefine((c, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const noHour = !c.hourKnown;
    if ((c.pillars.hour === null) !== noHour) fail('pillars', '时柱与 hourKnown 不一致');
    if ((c.hidden_stems.hour === null) !== noHour)
      fail('hidden_stems', '时柱藏干与 hourKnown 不一致');
    if ((c.ten_gods.hour === null) !== noHour) fail('ten_gods', '时柱十神与 hourKnown 不一致');
    if ((c.input_echo.time === null) !== noHour) fail('hourKnown', '与输入时间不一致');
    if ((c.true_solar_time !== null) !== (c.tst_status === '已校正')) {
      fail('true_solar_time', '与 tst_status 不一致');
    }
    if (c.tst_status === '已校正' && c.near_shichen_boundary) {
      fail('near_shichen_boundary', '已校正时应为 false');
    }
    if (c.dayun.approximate !== noHour) fail('dayun', 'approximate 与 hourKnown 不一致');
    if (!noHour && (c.jieqi_on_birthday !== null || c.jieqi_side !== null)) {
      fail('jieqi_on_birthday', '知道时辰时应为 null');
    }
    if ((c.uncertain.month_pillar === null) !== (c.uncertain.jieqi_time === null)) {
      fail('uncertain', 'month_pillar 与 jieqi_time 应同时存在');
    }
    const order = c.rules_hit.map((r) => CAL_RULE_IDS.indexOf(r));
    if (order.some((v, i) => i > 0 && v <= (order[i - 1] as number))) {
      fail('rules_hit', '应去重并按 CAL_RULE_IDS 顺序排列');
    }
  });
