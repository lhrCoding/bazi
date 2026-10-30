/**
 * 排盘错误：一律用错误码（ARCHITECTURE §4.1）。错误信息里不带任何输入值，避免出生信息进入日志。
 */
export type BaziErrorCode =
  /** 出生时刻超出支持范围（1900–2100 年） */
  'E_DATE_OUT_OF_RANGE';

export class BaziError extends Error {
  readonly code: BaziErrorCode;
  constructor(code: BaziErrorCode, message: string) {
    super(message);
    this.name = 'BaziError';
    this.code = code;
  }
}
