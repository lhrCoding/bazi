/**
 * 排盘错误：一律用错误码（ARCHITECTURE §4.1）。错误信息里不带任何输入值，避免出生信息进入日志。
 * 面向用户的中文提示见 BAZI_ERROR_MESSAGES（表单 / API 按错误码取，不使用 Error.message）。
 */
export type BaziErrorCode =
  /** 出生时刻超出支持范围（1900–2100 年） */
  | 'E_DATE_OUT_OF_RANGE'
  /** 公历日期 / 钟表时间格式错误或不存在（如 2 月 30 日、25:00）；农历日期格式错误、月份不在 1–12、日不在 1–30 */
  | 'E_INVALID_DATETIME'
  /** IANA 时区名无效 */
  | 'E_INVALID_TIMEZONE'
  /** 夏令时开始日被跳过的钟表时刻（该时刻不存在，CAL-TZ） */
  | 'E_DST_GAP'
  /** 出生地经度无效（非有限数或超出 −180～180，CAL-TST） */
  | 'E_INVALID_LONGITUDE'
  /** 农历：所选年份没有这个闰月（CAL-INPUT） */
  | 'E_LUNAR_NO_LEAP'
  /** 农历：该月是小月（29 天），没有三十（CAL-INPUT） */
  | 'E_LUNAR_DAY_OVERFLOW'
  /** 出生信息结构不合法（缺字段、多字段、类型或格式不对；computeChart 的 Zod 输入校验） */
  | 'E_INVALID_INPUT'
  /** 出生地代码在地区表中不存在 */
  | 'E_UNKNOWN_PLACE'
  /** 参考日期不合法（须为 1900–2100 年内的 Unix 毫秒整数；由服务端传入，不是用户输入） */
  | 'E_INVALID_REF_DATE';

/** 错误码 → 面向用户的中文提示（不含任何输入值）。 */
export const BAZI_ERROR_MESSAGES: Readonly<Record<BaziErrorCode, string>> = {
  E_DATE_OUT_OF_RANGE: '仅支持 1900 年至 2100 年出生的日期，请核对出生年份。',
  E_INVALID_DATETIME: '出生日期或时间不存在，请核对后重新填写。',
  E_INVALID_TIMEZONE: '出生地时区无法识别，请重新选择出生地。',
  E_DST_GAP: '该时刻因当年实行夏令时而不存在，请核对出生证上的时间。',
  E_INVALID_LONGITUDE: '出生地经度无效，请重新选择出生地。',
  E_LUNAR_NO_LEAP: '所选农历年份没有这个闰月，请核对是否为闰月。',
  E_LUNAR_DAY_OVERFLOW: '所选农历月份是小月，只有二十九天，请核对出生日期。',
  E_INVALID_INPUT: '出生信息填写不完整或格式不正确，请检查后重新提交。',
  E_UNKNOWN_PLACE: '未找到所选出生地，请重新选择。',
  E_INVALID_REF_DATE: '系统时间异常，请稍后重试。',
};

/** 取错误码对应的中文提示。 */
export function baziErrorMessage(code: BaziErrorCode): string {
  return BAZI_ERROR_MESSAGES[code];
}

export class BaziError extends Error {
  readonly code: BaziErrorCode;
  constructor(code: BaziErrorCode, message: string) {
    super(message);
    this.name = 'BaziError';
    this.code = code;
  }
}
