/**
 * 出生地 → 经度 / 时区静态表（ARCHITECTURE §4.1：区县级行政区划代码 → 经度 0.01° + IANA 时区；代码只增不删）。
 *
 * 【临时小表，T06】只含几个城市，供真太阳时（CAL-TST）开发与测试使用。
 * - 键为行政区划代码（省级 / 地级），正式表（T40）同样覆盖省级、地级、区县级，故这些代码在正式表中继续有效。
 * - 经度为城市中心近似值（0.01°）：乌鲁木齐、哈尔滨与 rules/cases.json 的 birthplace.longitude 一致；
 *   其余为常用公开值，**数据来源与许可证尚未核实**。T40 用核实过来源与许可证的正式数据整体替换本表，
 *   届时以正式数据为准（经度差异 ≤ 0.05° 时对真太阳时影响 ≤ 12 秒）。
 */

export interface Place {
  /** 行政区划代码 */
  code: string;
  name: string;
  /** 经度（度，东经为正，0.01° 精度） */
  longitude: number;
  /** IANA 时区 */
  timezone: string;
}

const PLACES: readonly Place[] = [
  { code: '110000', name: '北京市', longitude: 116.41, timezone: 'Asia/Shanghai' },
  { code: '310000', name: '上海市', longitude: 121.47, timezone: 'Asia/Shanghai' },
  { code: '440100', name: '广东省广州市', longitude: 113.26, timezone: 'Asia/Shanghai' },
  { code: '230100', name: '黑龙江省哈尔滨市', longitude: 126.63, timezone: 'Asia/Shanghai' },
  { code: '540100', name: '西藏自治区拉萨市', longitude: 91.13, timezone: 'Asia/Shanghai' },
  // 新疆出生证一般记北京时间（表单提示「请填北京时间」，calendar.md §5），时区仍用 Asia/Shanghai
  {
    code: '650100',
    name: '新疆维吾尔自治区乌鲁木齐市',
    longitude: 87.62,
    timezone: 'Asia/Shanghai',
  },
];

const BY_CODE: ReadonlyMap<string, Place> = new Map(PLACES.map((p) => [p.code, p]));

/** 按代码查出生地；未知代码返回 null（由调用方映射为错误码）。 */
export function findPlace(code: string): Place | null {
  return BY_CODE.get(code) ?? null;
}

/** 全部条目（只读），供测试与后续搜索接口使用。 */
export function listPlaces(): readonly Place[] {
  return PLACES;
}
