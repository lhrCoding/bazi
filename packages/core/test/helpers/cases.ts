/**
 * rules/cases.json（v2）读取与校验，并把每个案例的 input 映射为内部 BirthInput。
 *
 * - 只在测试中使用；cases.json 由 mingli-expert 维护，这里只读，不做任何修正。
 * - 结构校验失败直接抛错（带案例编号与字段路径），保证「解析成功」是真的成功。
 * - 校验只覆盖对照测试会用到的字段；说明性字段（reasoning、verified 等）原样保留在 raw 里。
 */
import type { BirthInput, Gender } from '../../src/bazi/types';
import { isGanZhi } from '../../src/bazi/ganzhi';
import { readRulesFile } from './fixtures';

// ---------- cases.json 原始结构（只声明会被读取的字段） ----------

export interface RawBirthplace {
  name: string;
  longitude: number;
}

export interface RawLunar {
  year: number;
  month: number;
  day: number;
  is_leap: boolean;
  time?: string;
  note?: string;
}

export interface RawInput {
  calendar: 'solar' | 'lunar';
  solar_datetime: string | null;
  solar_date: string;
  time_known: boolean;
  gender: Gender;
  timezone: string;
  birthplace: RawBirthplace | null;
  lunar?: RawLunar;
}

/** expected 保持原样（对照工具按字段路径取值），只对关键字段做结构校验。 */
export type RawExpected = Record<string, unknown> & {
  pillars: { year: string; month: string; day: string; hour: string | null };
};

export interface RawCase {
  id: string;
  title: string;
  tags: string[];
  input: RawInput;
  expected: RawExpected;
  [k: string]: unknown;
}

export interface CasesMeta {
  version: string;
  test_guidance: string[];
  [k: string]: unknown;
}

export interface LoadedCase {
  id: string;
  title: string;
  tags: string[];
  /** 映射后的引擎输入 */
  input: BirthInput;
  /** 案例给出的公历钟表时间 'YYYY-MM-DD HH:MM'（农历输入时为换算结果，供 T08 对照）；无时辰为 null */
  solarDateTime: string | null;
  solarDate: string;
  /** 原始出生地（名称 + 经度），供 T06 对照经度 */
  birthplace: RawBirthplace | null;
  expected: RawExpected;
  raw: RawCase;
}

export interface LoadedCases {
  meta: CasesMeta;
  cases: LoadedCase[];
}

// ---------- 测试用出生地代码 ----------

/**
 * cases.json 的 birthplace 只有名称 + 经度，BirthInput 用 placeCode。
 * 这里是测试专用的名称 → 代码对照（行政区划代码，地级市），正式地区表见 T40。
 * 经度必须与 cases.json 一致，否则视为表不同步而报错。
 */
export const TEST_PLACE_CODES: Readonly<Record<string, { code: string; longitude: number }>> = {
  新疆乌鲁木齐: { code: '650100', longitude: 87.62 },
  黑龙江哈尔滨: { code: '230100', longitude: 126.63 },
};

// ---------- 校验小工具 ----------

class CasesFormatError extends Error {
  constructor(where: string, msg: string) {
    super(`cases.json 格式错误 [${where}]：${msg}`);
    this.name = 'CasesFormatError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function req<T>(cond: boolean, where: string, msg: string, v: unknown): T {
  if (!cond) throw new CasesFormatError(where, msg);
  return v as T;
}

function str(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k];
  return req<string>(typeof v === 'string' && v.length > 0, `${where}.${k}`, '应为非空字符串', v);
}

function strOrNull(o: Record<string, unknown>, k: string, where: string): string | null {
  const v = o[k];
  return req<string | null>(
    v === null || (typeof v === 'string' && v.length > 0),
    `${where}.${k}`,
    '应为非空字符串或 null',
    v,
  );
}

function bool(o: Record<string, unknown>, k: string, where: string): boolean {
  const v = o[k];
  return req<boolean>(typeof v === 'boolean', `${where}.${k}`, '应为布尔值', v);
}

function int(o: Record<string, unknown>, k: string, where: string): number {
  const v = o[k];
  return req<number>(Number.isInteger(v), `${where}.${k}`, '应为整数', v);
}

function obj(o: Record<string, unknown>, k: string, where: string): Record<string, unknown> {
  const v = o[k];
  return req<Record<string, unknown>>(isObj(v), `${where}.${k}`, '应为对象', v);
}

function arr(o: Record<string, unknown>, k: string, where: string): unknown[] {
  const v = o[k];
  return req<unknown[]>(Array.isArray(v), `${where}.${k}`, '应为数组', v);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2}) (([01]\d|2[0-3]):[0-5]\d)$/;

function isValidSolarDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function ganzhi(o: Record<string, unknown>, k: string, where: string, nullable: boolean) {
  const v = o[k];
  if (nullable && v === null) return null;
  return req<string>(
    typeof v === 'string' && isGanZhi(v),
    `${where}.${k}`,
    '应为 60 甲子中的干支',
    v,
  );
}

// ---------- 解析 ----------

function parseInput(raw: unknown, where: string): RawInput {
  const o = req<Record<string, unknown>>(isObj(raw), where, '应为对象', raw);
  const calendar = str(o, 'calendar', where);
  req(calendar === 'solar' || calendar === 'lunar', `${where}.calendar`, '应为 solar / lunar', 0);
  const solar_date = str(o, 'solar_date', where);
  req(isValidSolarDate(solar_date), `${where}.solar_date`, '不是合法公历日期', 0);
  const time_known = bool(o, 'time_known', where);
  const solar_datetime = strOrNull(o, 'solar_datetime', where);
  if (time_known) {
    const m = solar_datetime === null ? null : DATETIME_RE.exec(solar_datetime);
    req(m !== null, `${where}.solar_datetime`, '有时辰时应为 YYYY-MM-DD HH:MM', 0);
    req(m?.[1] === solar_date, `${where}.solar_datetime`, '日期部分与 solar_date 不一致', 0);
  } else {
    req(solar_datetime === null, `${where}.solar_datetime`, '不知道时辰时应为 null', 0);
  }
  const gender = str(o, 'gender', where);
  req(gender === '男' || gender === '女', `${where}.gender`, '应为 男 / 女', 0);
  const timezone = str(o, 'timezone', where);

  let birthplace: RawBirthplace | null = null;
  if (o.birthplace !== null) {
    const bp = obj(o, 'birthplace', where);
    const lon = bp.longitude;
    req(
      typeof lon === 'number' && lon >= -180 && lon <= 180,
      `${where}.birthplace.longitude`,
      '应为经度数值',
      0,
    );
    birthplace = { name: str(bp, 'name', `${where}.birthplace`), longitude: lon as number };
  }

  let lunar: RawLunar | undefined;
  if (o.lunar !== undefined) {
    const lw = `${where}.lunar`;
    const lo = obj(o, 'lunar', where);
    lunar = {
      year: int(lo, 'year', lw),
      month: int(lo, 'month', lw),
      day: int(lo, 'day', lw),
      is_leap: bool(lo, 'is_leap', lw),
    };
    req(lunar.month >= 1 && lunar.month <= 12, `${lw}.month`, '应在 1–12', 0);
    req(lunar.day >= 1 && lunar.day <= 30, `${lw}.day`, '应在 1–30', 0);
    if (lo.time !== undefined) {
      const t = str(lo, 'time', lw);
      req(TIME_RE.test(t), `${lw}.time`, '应为 HH:MM', 0);
      lunar.time = t;
    }
    if (lo.note !== undefined) lunar.note = str(lo, 'note', lw);
  }
  if (calendar === 'lunar') req(lunar !== undefined, `${where}.lunar`, '农历输入缺少 lunar', 0);

  const input: RawInput = {
    calendar: calendar as RawInput['calendar'],
    solar_datetime,
    solar_date,
    time_known,
    gender: gender as Gender,
    timezone,
    birthplace,
  };
  if (lunar) input.lunar = lunar;
  return input;
}

function parseExpected(raw: unknown, where: string, timeKnown: boolean): RawExpected {
  const e = req<Record<string, unknown>>(isObj(raw), where, '应为对象', raw);
  const pw = `${where}.pillars`;
  const p = obj(e, 'pillars', where);
  const pillars = {
    year: ganzhi(p, 'year', pw, false) as string,
    month: ganzhi(p, 'month', pw, false) as string,
    day: ganzhi(p, 'day', pw, false) as string,
    hour: ganzhi(p, 'hour', pw, true),
  };
  req(
    timeKnown === (pillars.hour !== null),
    `${pw}.hour`,
    '有时辰时应有时柱、无时辰时应为 null',
    0,
  );

  // 吉神：名称 + hits[{pos, by[]}]
  arr(e, 'shensha_ji', where).forEach((item, i) => {
    const w = `${where}.shensha_ji[${i}]`;
    const s = req<Record<string, unknown>>(isObj(item), w, '应为对象', item);
    str(s, 'name', w);
    arr(s, 'hits', w).forEach((h, j) => {
      const hw = `${w}.hits[${j}]`;
      const ho = req<Record<string, unknown>>(isObj(h), hw, '应为对象', h);
      str(ho, 'pos', hw);
      const by = arr(ho, 'by', hw);
      req(
        by.length > 0 && by.every((b) => typeof b === 'string'),
        `${hw}.by`,
        '应为非空字符串数组',
        0,
      );
    });
  });

  // 旺衰
  const sw = `${where}.strength`;
  const st = obj(e, 'strength', where);
  req(typeof st.S === 'number', `${sw}.S`, '应为数值', 0);
  str(st, 'level', sw);
  strOrNull(st, 'special', sw);
  for (const k of ['power', 'gods']) {
    const rec = obj(st, k, sw);
    req(
      Object.keys(rec).length === 5 && Object.values(rec).every((v) => typeof v === 'number'),
      `${sw}.${k}`,
      '应为 5 个数值',
      0,
    );
  }

  // 喜用
  const yw = `${where}.yongshen`;
  const y = obj(e, 'yongshen', where);
  str(y, 'yong', yw);
  for (const k of ['xi', 'ji', 'xian']) {
    req(
      arr(y, k, yw).every((v) => typeof v === 'string'),
      `${yw}.${k}`,
      '应为字符串数组',
      0,
    );
  }

  // 规则编号
  req(
    arr(e, 'rules_hit_expected', where).every((v) => typeof v === 'string' && v.length > 0),
    `${where}.rules_hit_expected`,
    '应为非空字符串数组',
    0,
  );

  // 大运（三柱案例可以没有）
  if (e.dayun !== undefined) {
    const dw = `${where}.dayun`;
    const d = obj(e, 'dayun', where);
    const dir = str(d, 'direction', dw);
    req(dir === '顺' || dir === '逆', `${dw}.direction`, '应为 顺 / 逆', 0);
    const qd = strOrNull(d, 'qiyun_date', dw);
    req(qd === null || isValidSolarDate(qd), `${dw}.qiyun_date`, '应为合法日期或 null', 0);
    const first3 = arr(d, 'first3', dw);
    req(first3.length === 3, `${dw}.first3`, '应有 3 步', 0);
    first3.forEach((s, i) => {
      const fw = `${dw}.first3[${i}]`;
      const so = req<Record<string, unknown>>(isObj(s), fw, '应为对象', s);
      ganzhi(so, 'ganzhi', fw, false);
      req(
        so.start_year === null || Number.isInteger(so.start_year),
        `${fw}.start_year`,
        '应为整数或 null',
        0,
      );
    });
  }

  // 23:00 换日派对照
  if (e.alt_zi_huanri_school !== undefined) {
    const aw = `${where}.alt_zi_huanri_school`;
    const a = obj(e, 'alt_zi_huanri_school', where);
    ganzhi(a, 'day', aw, false);
    ganzhi(a, 'hour', aw, false);
  }

  return e as RawExpected;
}

function parseCase(raw: unknown, index: number): RawCase {
  const where0 = `cases[${index}]`;
  const o = req<Record<string, unknown>>(isObj(raw), where0, '应为对象', raw);
  const id = str(o, 'id', where0);
  req(/^C\d{2}$/.test(id), `${where0}.id`, '应为 C + 两位数字', 0);
  const title = str(o, 'title', id);
  const tags = arr(o, 'tags', id);
  req(
    tags.every((t) => typeof t === 'string'),
    `${id}.tags`,
    '应为字符串数组',
    0,
  );
  const input = parseInput(o.input, `${id}.input`);
  const expected = parseExpected(o.expected, `${id}.expected`, input.time_known);
  return { ...o, id, title, tags: tags as string[], input, expected };
}

/** 把案例 input 映射为 BirthInput（不做任何历法计算）。 */
export function toBirthInput(c: RawCase): BirthInput {
  const inp = c.input;
  if (inp.timezone !== 'Asia/Shanghai') {
    // BirthInput 没有时区字段（由 placeCode 决定，默认 Asia/Shanghai）；出现其他时区说明需要扩展地区表。
    throw new CasesFormatError(
      `${c.id}.input.timezone`,
      '暂只支持 Asia/Shanghai，需要先在测试地区表中加入对应出生地',
    );
  }

  let placeCode: string | null = null;
  if (inp.birthplace) {
    const entry = TEST_PLACE_CODES[inp.birthplace.name];
    if (!entry) {
      throw new CasesFormatError(
        `${c.id}.input.birthplace`,
        `测试地区表缺少「${inp.birthplace.name}」`,
      );
    }
    if (entry.longitude !== inp.birthplace.longitude) {
      throw new CasesFormatError(`${c.id}.input.birthplace`, '经度与测试地区表不一致');
    }
    placeCode = entry.code;
  }

  const solarTime = inp.solar_datetime === null ? null : inp.solar_datetime.slice(11);

  if (inp.calendar === 'lunar') {
    const l = inp.lunar;
    if (!l) throw new CasesFormatError(`${c.id}.input.lunar`, '农历输入缺少 lunar');
    const time = inp.time_known ? (l.time ?? null) : null;
    if (inp.time_known && time !== solarTime) {
      throw new CasesFormatError(`${c.id}.input.lunar.time`, '与 solar_datetime 的时间不一致');
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      calendar: 'lunar',
      date: `${l.year}-${pad(l.month)}-${pad(l.day)}`,
      isLeapMonth: l.is_leap,
      time,
      gender: inp.gender,
      placeCode,
      jieqiChoice: null,
    };
  }

  return {
    calendar: 'solar',
    date: inp.solar_date,
    time: solarTime,
    gender: inp.gender,
    placeCode,
    jieqiChoice: null,
  };
}

/** 解析整个 cases.json（已 JSON.parse 的对象）。 */
export function parseCasesFile(json: unknown): LoadedCases {
  const root = req<Record<string, unknown>>(isObj(json), 'root', '应为对象', json);
  const m = obj(root, '_meta', 'root');
  const version = str(m, 'version', '_meta');
  req(version === 'v2', '_meta.version', `只支持 v2，实际为 ${version}`, 0);
  const guidance = arr(m, 'test_guidance', '_meta');
  req(
    guidance.length > 0 && guidance.every((g) => typeof g === 'string'),
    '_meta.test_guidance',
    '应为非空字符串数组',
    0,
  );

  const rawCases = arr(root, 'cases', 'root');
  const seen = new Set<string>();
  const cases = rawCases.map((rc, i) => {
    const c = parseCase(rc, i);
    req(!seen.has(c.id), `${c.id}`, '案例编号重复', 0);
    seen.add(c.id);
    return {
      id: c.id,
      title: c.title,
      tags: c.tags,
      input: toBirthInput(c),
      solarDateTime: c.input.solar_datetime,
      solarDate: c.input.solar_date,
      birthplace: c.input.birthplace,
      expected: c.expected,
      raw: c,
    } satisfies LoadedCase;
  });

  return { meta: { ...m, version, test_guidance: guidance as string[] }, cases };
}

/** 从仓库 rules/cases.json 读取并解析。 */
export function loadCases(): LoadedCases {
  return parseCasesFile(JSON.parse(readRulesFile('cases.json')) as unknown);
}
