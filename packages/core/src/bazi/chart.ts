/**
 * 排盘公开 API：computeChart(input, refDate)（ARCHITECTURE §4、§4.1）。
 *
 * 流水线（rules/calendar.md §0）：
 *   CAL-INPUT（农历 → 公历、非法日期）→ CAL-TZ（出生地时区，默认 Asia/Shanghai）→ CAL-YM（绝对时刻比节气）
 *   → CAL-TST（选了出生地才校正）→ CAL-DH（日柱、时柱，早晚子时）→ CAL-YUN → 流年表（refDate）；
 *   不知道时辰走 CAL-NOHOUR（三柱模式，见 no-hour.ts）。
 *
 * 约定：
 * - 纯函数：不读系统时钟、不读环境变量、不做 IO；同输入（input、refDate、ENGINE_VERSION）永远同输出。
 * - refDate：Unix 毫秒整数（免费页 = 当前时间；付费报告 = 订单 createdAt，订单表同样存毫秒）。
 * - 输入用 BirthInputSchema 校验；任何失败都只抛 BaziError（错误码），错误信息不含输入值，
 *   也不把 Zod 的错误信息（会带上收到的值）往外抛。
 * - 输出返回前用 ChartSchema 校验；校验失败属于引擎缺陷，抛出的 Error 只含字段路径。
 * - rules_hit：去重后按 CAL_RULE_IDS 顺序排列。知道时辰时 CAL-TST 无论是否校正都记录
 *   （未选出生地也走了 CAL-TST 的「不校正、标记未校正」分支）；三柱模式不涉及时柱，不记录 CAL-TST。
 * - 三柱模式 tst_status 恒为「未校正」、true_solar_time 为 null、near_shichen_boundary 为 false
 *   （日柱按所填日期，真太阳时不参与任何一柱）。
 */
import { findPlace } from '../geo';
import { clockToUtc, DEFAULT_TIMEZONE, describeUtc } from './clock';
import { computeDayHour } from './day-hour';
import { computeDayun } from './dayun';
import { BaziError } from './errors';
import type { Gan, GanZhi, Zhi } from './ganzhi';
import { computeLiunian } from './liunian';
import { resolveSolarDate } from './lunar-input';
import { computeNoHour } from './no-hour';
import { BirthInputSchema, CAL_RULE_IDS, ChartSchema } from './schema';
import { HIDDEN_STEMS, tenGodOf } from './ten-gods';
import { computeTrueSolarTime } from './true-solar-time';
import type { CalRuleId, Chart, HiddenStem } from './types';
import { ENGINE_VERSION } from './version';
import { computeYearMonth, SUPPORTED_RANGE_UTC_MS } from './year-month';

const stemOf = (gz: GanZhi) => gz.charAt(0) as Gan;
const branchOf = (gz: GanZhi) => gz.charAt(1) as Zhi;

function hiddenStemsOf(dayGan: Gan, gz: GanZhi): HiddenStem[] {
  return HIDDEN_STEMS[branchOf(gz)].map(([gan, ratio]) => ({
    gan,
    ratio,
    ten_god: tenGodOf(dayGan, gan),
  }));
}

/** 去重并按判定流程排序；出现未登记的编号属于引擎缺陷。 */
function normalizeRulesHit(hits: readonly string[]): CalRuleId[] {
  const set = new Set(hits);
  for (const h of set) {
    if (!(CAL_RULE_IDS as readonly string[]).includes(h)) {
      throw new Error('排盘输出了未登记的 CAL 规则编号');
    }
  }
  return CAL_RULE_IDS.filter((id) => set.has(id));
}

function assertRefDate(refDate: number): void {
  if (
    !Number.isSafeInteger(refDate) ||
    refDate < SUPPORTED_RANGE_UTC_MS.min ||
    refDate >= SUPPORTED_RANGE_UTC_MS.max
  ) {
    throw new BaziError('E_INVALID_REF_DATE', '参考日期不合法');
  }
}

/**
 * 排盘。
 * @param input 出生信息（BirthInput；未经校验的数据也可以直接传入，由本函数校验）
 * @param refDate 参考日期（Unix 毫秒整数），决定流年起始年与所在大运
 * @throws BaziError 输入不合法、日期超出范围、夏令时不存在的时刻、出生地未知等（只含错误码）
 */
export function computeChart(input: unknown, refDate: number): Chart {
  assertRefDate(refDate);
  const parsed = BirthInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BaziError('E_INVALID_INPUT', '出生信息结构不合法');
  }
  const birth = parsed.data;

  let timezone = DEFAULT_TIMEZONE;
  let longitude: number | null = null;
  if (birth.placeCode !== null) {
    const place = findPlace(birth.placeCode);
    if (place === null) throw new BaziError('E_UNKNOWN_PLACE', '出生地代码不存在');
    timezone = place.timezone;
    longitude = place.longitude;
  }

  const resolved = resolveSolarDate(birth);
  const solarDate = resolved.solarDate;

  let core: Pick<
    Chart,
    | 'hourKnown'
    | 'pillars'
    | 'clock_to_utc'
    | 'true_solar_time'
    | 'tst_status'
    | 'near_shichen_boundary'
    | 'jieqi_prev'
    | 'jieqi_next'
    | 'jieqi_on_birthday'
    | 'jieqi_side'
    | 'alt'
    | 'uncertain'
    | 'dayun'
  >;
  let hits: string[];

  if (birth.time === null) {
    const nh = computeNoHour(solarDate, timezone, birth.gender, birth.jieqiChoice);
    core = {
      hourKnown: false,
      pillars: { year: nh.ym.year, month: nh.ym.month, day: nh.day, hour: null },
      clock_to_utc: describeUtc(nh.utcMs, timezone),
      true_solar_time: null,
      tst_status: '未校正',
      near_shichen_boundary: false,
      jieqi_prev: nh.ym.jieqi_prev,
      jieqi_next: nh.ym.jieqi_next,
      jieqi_on_birthday: nh.jieqiOnBirthday,
      jieqi_side: nh.side,
      alt: { zi_huanri_day_pillar: nh.day },
      uncertain: nh.uncertain,
      dayun: nh.dayun.dayun,
    };
    hits = [...resolved.rules_hit, ...nh.rules_hit];
  } else {
    const tz = clockToUtc(solarDate, birth.time, timezone);
    const ym = computeYearMonth(tz.utcMs);
    const tst = computeTrueSolarTime(tz.utcMs, longitude);
    const dh = computeDayHour(tst.local);
    const yun = computeDayun(tz.utcMs, birth.gender, ym);
    core = {
      hourKnown: true,
      pillars: { year: ym.year, month: ym.month, day: dh.day, hour: dh.hour },
      clock_to_utc: tz.clock_to_utc,
      true_solar_time: tst.true_solar_time,
      tst_status: tst.tst_status,
      near_shichen_boundary: tst.near_shichen_boundary,
      jieqi_prev: ym.jieqi_prev,
      jieqi_next: ym.jieqi_next,
      jieqi_on_birthday: null,
      jieqi_side: null,
      alt: { zi_huanri_day_pillar: dh.zi_huanri_day_pillar },
      uncertain: { month_pillar: null, jieqi_time: null },
      dayun: yun.dayun,
    };
    hits = [
      ...resolved.rules_hit,
      ...tz.rules_hit,
      ...ym.rules_hit,
      ...tst.rules_hit,
      ...dh.rules_hit,
      ...yun.rules_hit,
    ];
  }

  const { pillars } = core;
  const dayGan = stemOf(pillars.day);
  const chart: Chart = {
    engineVersion: ENGINE_VERSION,
    refDate,
    input_echo: birth,
    solar_date: solarDate,
    ...core,
    hidden_stems: {
      year: hiddenStemsOf(dayGan, pillars.year),
      month: hiddenStemsOf(dayGan, pillars.month),
      day: hiddenStemsOf(dayGan, pillars.day),
      hour: pillars.hour === null ? null : hiddenStemsOf(dayGan, pillars.hour),
    },
    ten_gods: {
      year: tenGodOf(dayGan, stemOf(pillars.year)),
      month: tenGodOf(dayGan, stemOf(pillars.month)),
      day: '日主',
      hour: pillars.hour === null ? null : tenGodOf(dayGan, stemOf(pillars.hour)),
    },
    liunian: computeLiunian(refDate, core.dayun),
    rules_hit: normalizeRulesHit(hits),
  };

  const checked = ChartSchema.safeParse(chart);
  if (!checked.success) {
    const paths = checked.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new Error(`排盘输出未通过 Chart schema 校验：${paths}`);
  }
  return chart;
}
