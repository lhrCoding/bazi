/**
 * 隐私说明 / 免责声明的固定文字（TASKS T46；ARCHITECTURE §7，原型 design/legal.html）。
 * 「服务器保存哪些字段」逐项对应 orders 表（server/orders/schema.ts ORDER_COLUMNS），test/legal.test.ts 比对两边一致：
 * 表结构增删字段时，这里必须同步，否则测试失败。
 * 上线前需按实际情况与法律意见定稿（HANDOFF D9）。
 */

export interface StoredField {
  /** 对应的 orders 列名 */
  columns: readonly string[];
  label: string;
  desc: string;
}

export const PRIVACY_STORED_FIELDS: readonly StoredField[] = [
  { columns: ['order_no'], label: '订单号', desc: '随机生成，也是支付账单里的商户订单号' },
  {
    columns: ['amount_fen', 'status', 'created_at', 'paid_at', 'closed_at', 'refunded_at'],
    label: '金额、状态、时间',
    desc: '¥9.9；创建 / 已支付 / 已关闭 / 已退款；对应时间',
  },
  {
    columns: ['birth_fp', 'fp_key_id'],
    label: '出生信息指纹',
    desc: '用服务器密钥计算的不可逆摘要（及密钥编号），只用来核对「打开报告的链接是不是下单时那一份」，无法反推出生日期',
  },
  { columns: ['texts_version'], label: '素材库版本号', desc: '保证你以后重看时文字不变' },
  {
    columns: ['channel', 'channel_txn_id'],
    label: '支付渠道、渠道流水号',
    desc: '对账与人工退款用',
  },
  { columns: ['refund_reason'], label: '退款原因', desc: '仅在退款时填写，不含出生信息' },
];

export const DISCLAIMER_SHORT = '内容为传统文化参考与娱乐，不构成医疗、投资、法律建议';

export const DISCLAIMER_ITEMS: readonly string[] = [
  '不构成医疗、心理、投资、法律或任何专业建议；身体不适请及时就医，重大决定请咨询专业人士。',
  '报告中的「倾向」「适合」「可以留意」均为参考性表述，不是对未来的断言。',
  '除这份报告外，我们不销售、也不推荐任何服务或物品。',
  '命理存在不同流派，本站口径（早晚子时派、只认真从格、真太阳时仅在选择出生地时校正等）写在报告第八章。',
];

/** GeoNames CC BY 4.0 署名（HANDOFF 技术债，用户 2026-11-12 同意） */
export const GEO_ATTRIBUTION =
  '出生地经纬度数据部分来自 GeoNames（geonames.org），按 CC BY 4.0 许可使用。';
