/** 出生地表的行（places.data.ts 由 scripts/geo/build-places.ts 生成） */
export interface PlaceRow {
  /** 行政区划代码（6 位）或海外 / 台湾城市 X-<GeoNames id> */
  code: string;
  /** 本级名称，如「东城区」 */
  name: string;
  /** 带上级的全称，如「北京市东城区」 */
  full: string;
  /** county 县级；prefecture 地级（城市点）；municipality 直辖市；region 港澳台整体；city 台湾 / 海外城市 */
  level: 'county' | 'prefecture' | 'municipality' | 'region' | 'city';
  /** 经度（度，东经为正，0.01°） */
  lon: number;
  /** IANA 时区 */
  tz: string;
  /** 全拼（无声调、无空格） */
  py: string;
  /** 拼音首字母 */
  pyi: string;
  /** 来源坐标相互矛盾、取均值的低精度条目 */
  low?: true;
}
