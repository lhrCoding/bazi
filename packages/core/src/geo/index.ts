/**
 * 出生地 → 经度 / 时区（TASKS T40；ARCHITECTURE §4.1，calendar.md §4–§5）。
 *
 * 数据在 places.data.ts（由 scripts/geo/build-places.ts 生成，文件头写明来源与许可：民政部名单、Wikidata CC0 坐标、
 * GeoNames CC BY 4.0 海外城市）。T06 的临时小表已整体替换；其中的代码（110000、440100、650100 等）在正式表中继续有效。
 * - findPlace(code)：排盘用（真太阳时需要经度，时区换算用 IANA 时区）。
 * - searchPlaces(query)：首页出生地输入框用，按中文名 / 全拼 / 拼音首字母前缀搜索。
 * 代码只增不删（test/places.test.ts 与 test/fixtures/place-codes.txt 比对）。
 */
import { PLACE_ROWS } from './places.data';
import type { PlaceRow } from './types';

export type { PlaceRow } from './types';
export { PLACES_SOURCE_DATE } from './places.data';

export interface Place {
  /** 行政区划代码，或台湾 / 海外城市 X-<GeoNames id> */
  code: string;
  /** 带上级的全称，如「北京市东城区」 */
  name: string;
  /** 经度（度，东经为正，0.01° 精度） */
  longitude: number;
  /** IANA 时区 */
  timezone: string;
  level: PlaceRow['level'];
  /** 来源坐标矛盾、取均值的低精度条目 */
  lowPrecision: boolean;
}

const toPlace = (r: PlaceRow): Place => ({
  code: r.code,
  name: r.full,
  longitude: r.lon,
  timezone: r.tz,
  level: r.level,
  lowPrecision: r.low === true,
});

const BY_CODE: ReadonlyMap<string, PlaceRow> = new Map(PLACE_ROWS.map((r) => [r.code, r]));

/** 按代码查出生地；未知代码返回 null（由调用方映射为错误码）。 */
export function findPlace(code: string): Place | null {
  const r = BY_CODE.get(code);
  return r ? toPlace(r) : null;
}

/** 全部条目（只读），供测试与搜索使用。 */
export function listPlaces(): readonly Place[] {
  return PLACE_ROWS.map(toPlace);
}

/** 搜索结果排序：县级与城市优先（出生地通常填到区县），其次直辖市 / 港澳台，地级最后 */
const LEVEL_RANK: Readonly<Record<PlaceRow['level'], number>> = {
  county: 0,
  city: 0,
  municipality: 1,
  region: 1,
  prefecture: 2,
};
/** 名称后缀（中文 / 拼音）：去掉后与输入相同即视为完全匹配 */
const NAME_SUFFIXES: readonly string[] = [
  '',
  '市',
  '县',
  '区',
  '旗',
  '盟',
  '州',
  '自治县',
  '自治旗',
  '地区',
  '林区',
  '特区',
];
const PY_SUFFIXES: readonly string[] = [
  '',
  'shi',
  'xian',
  'qu',
  'qi',
  'meng',
  'zhou',
  'zizhixian',
  'zizhiqi',
  'diqu',
  'linqu',
  'tequ',
];
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_QUERY = 20;

/**
 * 搜索出生地。
 * - 含汉字：本级名称前缀匹配（如「海淀」→ 海淀区），或全称包含（如「广州天河」不匹配，「广州市天河」匹配）。
 * - 拼音（只含字母）：全拼前缀（haidian）或首字母前缀（hd），不区分大小写。
 * 排序：本级名称完全相同 > 名称前缀 / 拼音匹配 > 全称包含；同档按层级、全称长度、代码。
 */
export function searchPlaces(query: string, limit = SEARCH_DEFAULT_LIMIT): Place[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '').slice(0, SEARCH_MAX_QUERY);
  if (q === '') return [];
  const isPinyin = /^[a-z]+$/.test(q);
  const scored: [number, PlaceRow][] = [];
  for (const r of PLACE_ROWS) {
    let score: number;
    if (isPinyin) {
      // 只差「市 / 县 / 区 / 旗…」后缀也算完全匹配：dongguan → 东莞市（dongguanshi）排在东光县（dongguangxian）之前
      if (r.py.startsWith(q)) score = PY_SUFFIXES.includes(r.py.slice(q.length)) ? 0 : 1;
      else if (r.pyi.startsWith(q)) score = r.pyi === q ? 1 : 2;
      else continue;
    } else if (
      r.name === q ||
      (NAME_SUFFIXES.includes(r.name.slice(q.length)) && r.name.startsWith(q))
    )
      score = 0;
    else if (r.name.startsWith(q)) score = 1;
    else if (r.full.includes(q)) score = 2;
    else continue;
    scored.push([score, r]);
  }
  scored.sort(
    ([sa, a], [sb, b]) =>
      sa - sb ||
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      a.full.length - b.full.length ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  return scored.slice(0, Math.max(0, limit)).map(([, r]) => toPlace(r));
}
