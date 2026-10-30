/**
 * 历法适配层：整个项目中**唯一** import tyme4ts 的文件（ARCHITECTURE §3、§4）。
 *
 * - 锁定版本 tyme4ts 1.5.4（MIT），升级必须跑完全部对照测试。
 * - provider 是 tyme4ts 的全局静态属性，只在本模块加载时设置一次（见下方）；其他文件禁止修改，
 *   本文件中依赖 provider 的函数每次调用前都会断言其仍为 Sect2，被改动则直接抛错。
 *   · LunarHour.provider = LunarSect2EightCharProvider：23:00–23:59 日柱算当日、时干按次日起
 *     （早晚子时派，calendar.md CAL-DH-ZI；库默认 DefaultEightCharProvider 是 23:00 换日，不用）。
 *   · ChildLimit.provider = LunarSect2ChildLimitProvider：起运按分钟折算（3 天 = 1 年、1 天 = 4 个月、
 *     1 小时 = 5 天、1 分钟 = 2 小时，calendar.md CAL-YUN）。
 * - 节气时刻：寿星天文历算法，tyme4ts 以北京标准时间（UTC+8）给出，精确到秒。
 * - 对外只暴露纯数据（数字、字符串），不泄漏 tyme4ts 的类型。
 */
import {
  ChildLimit,
  Gender as TymeGender,
  LunarDay,
  LunarHour,
  LunarMonth,
  LunarSect2ChildLimitProvider,
  LunarSect2EightCharProvider,
  SolarTerm,
  SolarTime,
  LunarYear,
} from 'tyme4ts';
import type { GanZhi } from './ganzhi';
import type { Gender } from './types';
import { isGanZhi } from './ganzhi';
import { fromBeijingParts, type DateTimeParts } from './time';

// ---------- provider：模块加载时显式设置 ----------

LunarHour.provider = new LunarSect2EightCharProvider();
ChildLimit.provider = new LunarSect2ChildLimitProvider();

export interface ProviderInfo {
  /** 八字（子时流派）provider 类名 */
  eightChar: string;
  /** 童限（起运）provider 类名 */
  childLimit: string;
  /** 两者是否都为本项目要求的 Sect2 */
  isSect2: boolean;
}

/** 当前 tyme4ts 全局 provider（供测试断言）。 */
export function providerInfo(): ProviderInfo {
  const ec = LunarHour.provider;
  const cl = ChildLimit.provider;
  // 用 instanceof 判断，避免依赖可能被压缩的类名；China95ChildLimitProvider 继承自 Sect2，需排除。
  const ecOk = ec instanceof LunarSect2EightCharProvider;
  const clOk =
    cl instanceof LunarSect2ChildLimitProvider && cl.constructor === LunarSect2ChildLimitProvider;
  return {
    eightChar: ecOk ? 'LunarSect2EightCharProvider' : ec.constructor.name,
    childLimit: clOk ? 'LunarSect2ChildLimitProvider' : cl.constructor.name,
    isSect2: ecOk && clOk,
  };
}

function assertSect2(): void {
  if (!providerInfo().isSect2) {
    throw new Error('tyme4ts provider 已被改动，不再是 Sect2（只允许 calendar-adapter.ts 设置）');
  }
}

// ---------- 节气 ----------

/** tyme4ts SolarTerm 序号：0 冬至、1 小寒、2 大寒、3 立春 …… 23 大雪；奇数为「节」。 */
export type SolarTermIndex = number;

export interface SolarTermMoment {
  /** 节气名称，如「立春」 */
  name: string;
  /** tyme4ts 序号（0 冬至 … 23 大雪） */
  index: SolarTermIndex;
  /** 公历年份（该节气实际发生的公历年；冬至序号 0 例外，发生在上一年 12 月，本项目不用） */
  year: number;
  /** 交节绝对时刻（Unix 毫秒，精确到秒） */
  utcMs: number;
}

/**
 * 某公历年的第 index 个节气（tyme4ts 约定：fromIndex(Y, 1) 为 Y 年 1 月小寒，fromIndex(Y, 23) 为 Y 年 12 月大雪）。
 * 只用于 index 1–23（序号 0 冬至实际落在上一年，调用方不需要）。
 */
export function solarTermMoment(year: number, index: SolarTermIndex): SolarTermMoment {
  if (!Number.isInteger(year) || !Number.isInteger(index) || index < 1 || index > 23) {
    throw new Error('节气序号或年份不合法');
  }
  const term = SolarTerm.fromIndex(year, index);
  const t = term.getJulianDay().getSolarTime();
  const parts: DateTimeParts = {
    year: t.getYear(),
    month: t.getMonth(),
    day: t.getDay(),
    hour: t.getHour(),
    minute: t.getMinute(),
    second: t.getSecond(),
  };
  return {
    name: term.getName(),
    index: term.getIndex(),
    year: term.getYear(),
    utcMs: fromBeijingParts(parts),
  };
}

// ---------- 交叉校验用：tyme4ts 自带的「一个时刻出四柱」 ----------

export interface TymePillars {
  year: GanZhi;
  month: GanZhi;
  day: GanZhi;
  hour: GanZhi;
}

function toGanZhi(name: string): GanZhi {
  if (!isGanZhi(name)) throw new Error('tyme4ts 返回了非法干支');
  return name;
}

/**
 * tyme4ts（Sect2）按北京标准时间某一时刻排出的四柱。
 * 仅用于交叉校验（年月柱由 year-month.ts 用节气时刻自行推出，日时柱由 T07 自行计算）。
 */
export function tymePillarsAt(beijing: DateTimeParts): TymePillars {
  assertSect2();
  const st = SolarTime.fromYmdHms(
    beijing.year,
    beijing.month,
    beijing.day,
    beijing.hour,
    beijing.minute,
    beijing.second,
  );
  const ec = st.getLunarHour().getEightChar();
  return {
    year: toGanZhi(ec.getYear().getName()),
    month: toGanZhi(ec.getMonth().getName()),
    day: toGanZhi(ec.getDay().getName()),
    hour: toGanZhi(ec.getHour().getName()),
  };
}

// ---------- 交叉校验用：tyme4ts 的起运与大运（CAL-YUN） ----------

export interface TymeDecade {
  ganzhi: GanZhi;
  /** 该步大运开始的公历年 */
  startYear: number;
  /** 开始虚岁（tyme4ts 口径：开始年 − 出生公历年 + 1） */
  startAgeXusui: number;
}

export interface TymeChildLimit {
  /** 是否顺排 */
  forward: boolean;
  years: number;
  months: number;
  days: number;
  hours: number;
  /** 起运时刻（北京标准时间） */
  end: DateTimeParts;
  /** 前 n 步大运 */
  decades: TymeDecade[];
}

/**
 * tyme4ts（Sect2 起运：按分钟折算）按北京标准时间某一时刻得到的起运与大运。
 * 仅用于交叉校验（dayun.ts 用 year-month.ts 的节气时刻自行计算）。
 */
export function tymeChildLimitAt(
  beijing: DateTimeParts,
  gender: Gender,
  decadeCount = 8,
): TymeChildLimit {
  assertSect2();
  const st = SolarTime.fromYmdHms(
    beijing.year,
    beijing.month,
    beijing.day,
    beijing.hour,
    beijing.minute,
    beijing.second,
  );
  const cl = ChildLimit.fromSolarTime(st, gender === '男' ? TymeGender.MAN : TymeGender.WOMAN);
  const e = cl.getEndTime();
  const decades: TymeDecade[] = [];
  let d = cl.getStartDecadeFortune();
  for (let i = 0; i < decadeCount; i++) {
    decades.push({
      ganzhi: toGanZhi(d.getName()),
      startYear: d.getStartSixtyCycleYear().getYear(),
      startAgeXusui: d.getStartAge(),
    });
    d = d.next(1);
  }
  return {
    forward: cl.isForward(),
    years: cl.getYearCount(),
    months: cl.getMonthCount(),
    days: cl.getDayCount(),
    hours: cl.getHourCount(),
    end: {
      year: e.getYear(),
      month: e.getMonth(),
      day: e.getDay(),
      hour: e.getHour(),
      minute: e.getMinute(),
      second: e.getSecond(),
    },
    decades,
  };
}

// ---------- 农历（CAL-INPUT） ----------
// 以下函数只做薄封装，参数合法性（年份范围、闰月是否存在、日数）由 lunar-input.ts 先行校验；
// tyme4ts 对非法参数抛出的 Error 信息含输入值，不得进入日志；lunar-input.ts 保证不会传入非法参数。

/** 农历某年的闰月月份（1–12）；无闰月为 0。 */
export function lunarLeapMonth(year: number): number {
  return LunarYear.fromYear(year).getLeapMonth();
}

/** 农历某月的天数（29 或 30）。isLeap = true 表示该年的闰月（调用方须先确认存在）。 */
export function lunarMonthDayCount(year: number, month: number, isLeap: boolean): number {
  return LunarMonth.fromYm(year, isLeap ? -month : month).getDayCount();
}

export interface YmdParts {
  year: number;
  month: number;
  day: number;
}

/** 农历日期 → 公历日期（tyme4ts 约定：负数月 = 闰月）。 */
export function lunarToSolarParts(
  year: number,
  month: number,
  day: number,
  isLeap: boolean,
): YmdParts {
  const s = LunarDay.fromYmd(year, isLeap ? -month : month, day).getSolarDay();
  return { year: s.getYear(), month: s.getMonth(), day: s.getDay() };
}
