/**
 * 排盘错误：一律用错误码（ARCHITECTURE §4.1）。错误信息里不带任何输入值，避免出生信息进入日志。
 */
export type BaziErrorCode =
  /** 出生时刻超出支持范围（1900–2100 年） */
  | 'E_DATE_OUT_OF_RANGE'
  /** 公历日期 / 钟表时间格式错误或不存在（如 2 月 30 日、25:00） */
  | 'E_INVALID_DATETIME'
  /** IANA 时区名无效 */
  | 'E_INVALID_TIMEZONE'
  /** 夏令时开始日被跳过的钟表时刻（该时刻不存在，CAL-TZ） */
  | 'E_DST_GAP'
  /** 出生地经度无效（非有限数或超出 −180～180，CAL-TST） */
  | 'E_INVALID_LONGITUDE';

export class BaziError extends Error {
  readonly code: BaziErrorCode;
  constructor(code: BaziErrorCode, message: string) {
    super(message);
    this.name = 'BaziError';
    this.code = code;
  }
}
