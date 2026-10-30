/**
 * 排盘引擎输入 / 输出类型（T03 初版）。
 *
 * - BirthInput 按 ARCHITECTURE §4.1 定义。
 * - Chart 按 ARCHITECTURE §4.1 与 rules/calendar.md §9 列出字段；
 *   T04–T12 逐步填充，T13 改为 Zod schema 定稿（届时以 schema 推导的类型替换本文件中的 Chart）。
 * - 全部字段 JSON 可序列化（时刻用字符串，不用 Date 对象）。
 */
import type { Gan, GanZhi } from './ganzhi';

export type Gender = '男' | '女';

/** 交节日且不知道时辰时，用户对「出生在交节前 / 后」的选择（CAL-NOHOUR）。 */
export type JieqiChoice = 'before' | 'after' | 'unsure';

export interface BirthInput {
  calendar: 'solar' | 'lunar';
  /** 'YYYY-MM-DD'；calendar = 'lunar' 时为农历年月日（月份不含闰字，闰月看 isLeapMonth）。 */
  date: string;
  /** 仅农历输入有意义：是否闰月。 */
  isLeapMonth?: boolean;
  /** 本地钟表时间 'HH:MM'；不知道时辰为 null（三柱模式）。 */
  time: string | null;
  gender: Gender;
  /** 出生地代码（core/geo 表）；null = 未选出生地，不做真太阳时校正，时区默认 Asia/Shanghai。 */
  placeCode: string | null;
  jieqiChoice: JieqiChoice | null;
}

export interface Pillars {
  year: GanZhi;
  month: GanZhi;
  day: GanZhi;
  /** 三柱模式为 null。 */
  hour: GanZhi | null;
}

export type PillarPos = 'year' | 'month' | 'day' | 'hour';

/** 节气（名称 + 北京时间精确时刻 'YYYY-MM-DD HH:MM:SS'）。 */
export interface JieqiMoment {
  name: string;
  time: string;
}

/** CAL-TZ：本地钟表时间 → UTC。 */
export interface ClockToUtc {
  /** 'YYYY-MM-DDTHH:MM:SSZ' */
  utc: string;
  timezone: string;
  utcOffsetMinutes: number;
  /** 夏令时结束日重复时刻：取较晚一次，并置此标记。 */
  dstAmbiguous: boolean;
}

/** CAL-TST：真太阳时（仅选了出生地时存在）。 */
export interface TrueSolarTime {
  /** 北京时间 'YYYY-MM-DD HH:MM' */
  beijingTime: string;
  /** 真太阳时 'YYYY-MM-DD HH:MM' */
  trueSolarTime: string;
  longitudeCorrectionMin: number;
  equationOfTimeMin: number;
}

export type TstStatus = '已校正' | '未校正';

export interface DayunStep {
  ganzhi: GanZhi;
  startYear: number;
  endYear: number;
  /** 对外展示用周岁 */
  startAge: number;
  /** 内部保留虚岁 */
  startAgeXusui: number;
}

/** 出生到相邻「节」的时间按 3 天 = 1 年折算后的起运间隔（CAL-YUN，按分钟折算，精确到 2 小时）。 */
export interface QiyunOffset {
  years: number;
  months: number;
  days: number;
  hours: number;
}

export interface Dayun {
  direction: '顺' | '逆';
  /** 起运间隔（出生 → 起运） */
  qiyunOffset: QiyunOffset;
  /** 起运时刻（北京标准时间 'YYYY-MM-DD HH:MM'） */
  qiyunTime: string;
  /** 起运日期 'YYYY-MM-DD' */
  qiyunDate: string;
  /** 起运时周岁（对外展示） */
  qiyunAge: number;
  /** 三柱模式按 12:00 计算，标记「约 X 岁起运」 */
  approximate: boolean;
  steps: DayunStep[];
}

export interface LiunianYear {
  year: number;
  ganzhi: GanZhi;
  /** 当年立春时刻（北京时间） */
  lichun: string;
  /** 所在大运干支；尚未起运为 null */
  dayun: GanZhi | null;
}

export interface Chart {
  engineVersion: string;
  /** 原样回显输入 */
  input_echo: BirthInput;
  pillars: Pillars;
  /** 各柱藏干（三柱模式 hour 为 null） */
  hidden_stems: Record<PillarPos, Gan[] | null>;
  /** 各柱天干相对日干的十神（日柱为「日主」） */
  ten_gods: Record<PillarPos, string | null>;
  clock_to_utc: ClockToUtc;
  true_solar_time: TrueSolarTime | null;
  tst_status: TstStatus;
  /** 未校正且出生时刻离时辰边界（奇数整点）不足 30 分钟：结果页加提示句（CAL-TST，仅提示不改排盘）。已校正恒为 false */
  near_shichen_boundary: boolean;
  jieqi_prev: JieqiMoment;
  jieqi_next: JieqiMoment;
  alt: {
    /** 23:00 换日派（不采用）的日柱，仅 23:00–23:59 出生时与主结果不同 */
    zi_huanri_day_pillar: GanZhi;
  };
  uncertain: {
    /** 交节日无时辰：[交节前年月柱, 交节后年月柱] */
    month_pillar: [[GanZhi, GanZhi], [GanZhi, GanZhi]] | null;
    jieqi_time: string | null;
  };
  dayun: Dayun;
  liunian: LiunianYear[];
  /** 命中的 CAL- 编号 */
  rules_hit: string[];
}
