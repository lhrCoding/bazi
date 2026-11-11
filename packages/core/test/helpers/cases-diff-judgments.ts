/**
 * T21 差异清单「建议」列：键为 `${案例} ${字段}`。Claude 的判断，最终由用户裁定。
 */
const OFFSET_2H =
  '期望值错（手算工具截秒，逆排比代码多 2 小时）。已决定沿用 tyme4ts Sect2 按秒口径（T09）→ 建议按代码值更新期望，verified 注明「代码复核」';
const C20_FILL =
  '期望值原为 null（待代码补出）。代码按 tyme4ts 节气时刻计算（T12 已与权威节气抽查一致；阴年男逆排，数到上一个节大雪）→ 建议按代码值补全';

export const JUDGMENTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    ['C01', 'C02', 'C05', 'C07', 'C08', 'C09', 'C11', 'C13', 'C14', 'C15'].map((id) => [
      `${id} dayun.qiyun_offset`,
      OFFSET_2H,
    ]),
  ),
  'C11 dayun.qiyun_date':
    '同一原因的连带差异：起运时刻差 2 小时恰好跨过午夜，日期差 1 天（cases.test.ts 允许 ±1 天故未报错）→ 建议按代码值更新',
  'C20 dayun.qiyun_date': C20_FILL,
  'C20 dayun.qiyun_offset': C20_FILL,
  'C20 dayun.first3.start_year': C20_FILL,
  'C20 dayun.first3.start_age_xusui': `${C20_FILL}（虚岁 = 起运年 − 1981 + 1）`,
};

/** 2026-11-11 用户裁定的差异（裁定前清单，裁定后已写入 cases.json v2.3；复跑应为 0 处差异）。 */
export const RESOLVED_2026_11_11: readonly (readonly [string, string, string, string, string])[] = [
  ...(
    [
      ['C01', '9年9月26天18时', '9年9月26天16时'],
      ['C02', '0年0月1天12时', '0年0月1天10时'],
      ['C05', '3年2月11天4时', '3年2月11天2时'],
      ['C07', '10年0月19天12时', '10年0月19天10时'],
      ['C08', '1年4月20天16时', '1年4月20天14时'],
      ['C09', '8年5月18天2时', '8年5月18天0时'],
      ['C11', '6年3月1天14时', '6年3月1天12时'],
      ['C13', '10年4月2天22时', '10年4月2天20时'],
      ['C14', '5年7月10天16时', '5年7月10天14时'],
      ['C15', '7年4月14天16时', '7年4月14天14时'],
    ] as const
  ).map(
    ([id, e, a]) => [id, 'dayun.qiyun_offset', e, a, '期望值错（手算截秒）→ 改为代码值'] as const,
  ),
  ['C11', 'dayun.qiyun_date', '1988-01-29', '1988-01-28', '同一原因跨午夜 → 改为代码值'],
  ['C20', 'dayun.qiyun_date', 'null', '1987-01-28', '由代码补全'],
  [
    'C20',
    'dayun.qiyun_offset',
    'null',
    '5年1月5天16时',
    '由代码补全（上一个节大雪 1981-12-07 12:51:15）',
  ],
  ['C20', 'dayun.first3.start_year', '[null,null,null]', '[1987,1997,2007]', '由代码补全'],
  ['C20', 'dayun.first3.start_age_xusui', '[null,null,null]', '[7,17,27]', '由代码补全'],
];
