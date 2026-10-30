/**
 * lunar-javascript 1.7.7（MIT，6tail）没有自带类型声明；这里只声明 T12 差分测试用到的最小子集。
 * 本文件只被 tsconfig.test.json 包含（src/ 的 tsconfig 看不到它，src 也被 ESLint 禁止 import 该库）。
 */
declare module 'lunar-javascript' {
  export interface EightChar {
    /** 1 = 23:00 换日；2 = 早晚子时（日柱当日、时干按次日起） */
    setSect(sect: 1 | 2): void;
    getSect(): number;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
  }
  export interface Lunar {
    getEightChar(): EightChar;
  }
  export interface Solar {
    getLunar(): Lunar;
  }
  export const Solar: {
    fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number,
    ): Solar;
  };
}
