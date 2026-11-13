/**
 * 首页表单的纯逻辑（TASKS T44；UI.md §4.2–§4.3）：下拉选项、情境提示、提交前校验、生成载荷。
 * 不依赖 React，便于单元测试。农历月份表由服务端组件算好传入（浏览器不加载历法库）。
 */
import type { PayloadV1 } from '@zhiming/core/birth';

export interface LunarMonth {
  m: number;
  leap: boolean;
  label: string;
  days: number;
}
/** 年 → 该年农历月份（按时间顺序，闰月紧跟所闰月份） */
export type LunarTable = Readonly<Record<number, readonly LunarMonth[]>>;

export const MIN_YEAR = 1930;

export interface FormState {
  cal: 's' | 'l';
  /** 年；'' 为未选 */
  y: string;
  /** 公历 '1'–'12'；农历 '1'–'12' 或闰月 'L1'–'L12' */
  m: string;
  d: string;
  hh: string;
  mm: string;
  nohour: boolean;
  g: 'm' | 'f' | null;
  place: { code: string; full: string; xinjiang: boolean } | null;
}

export const EMPTY_FORM: FormState = {
  cal: 's',
  y: '',
  m: '',
  d: '',
  hh: '',
  mm: '',
  nohour: false,
  g: null,
  place: null,
};

export type Opt = readonly [value: string, label: string];

const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
const DAY_TENS = ['初', '十', '廿', '三'] as const;
const DAY_UNITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
const pad = (n: number): string => String(n).padStart(2, '0');

export function lunarDayLabel(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return `${DAY_TENS[Math.floor(day / 10)]}${DAY_UNITS[(day % 10) - 1]}`;
}

export function yearOptions(thisYear: number): Opt[] {
  const out: Opt[] = [];
  for (let y = thisYear; y >= MIN_YEAR; y--) out.push([String(y), `${y}年`]);
  return out;
}

export function monthOptions(s: FormState, lunar: LunarTable): Opt[] {
  if (s.cal === 's') return Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}月`]);
  const months = lunar[Number(s.y)];
  if (!months) {
    const plain = lunar[2001]?.filter((x) => !x.leap) ?? [];
    return plain.map((x) => [String(x.m), x.label]);
  }
  return months.map((x) => [x.leap ? `L${x.m}` : String(x.m), x.label]);
}

export function dayOptions(s: FormState): Opt[] {
  const n = s.cal === 's' ? 31 : 30;
  return Array.from({ length: n }, (_, i) => [
    String(i + 1),
    s.cal === 's' ? `${i + 1}日` : lunarDayLabel(i + 1),
  ]);
}

export function hourOptions(): Opt[] {
  return Array.from({ length: 24 }, (_, h) => {
    const zhi = ZHI[Math.floor(((h + 1) % 24) / 2)] as string;
    const tag = h === 23 ? '（晚子）' : h === 0 ? '（早子）' : '';
    return [String(h), `${pad(h)} 时 · ${zhi}${tag}`];
  });
}

export function minuteOptions(): Opt[] {
  return Array.from({ length: 60 }, (_, m) => [String(m), `${pad(m)} 分`]);
}

/** 切换历法 / 年份后，原先选的月份若已不在新选项里就清空 */
export function keepMonth(s: FormState, lunar: LunarTable): FormState {
  if (s.m === '') return s;
  return monthOptions(s, lunar).some(([v]) => v === s.m) ? s : { ...s, m: '' };
}

export interface Hints {
  date: string | null;
  time: string | null;
}

export function hints(s: FormState, lunar: LunarTable): Hints {
  let date: string | null = null;
  const y = Number(s.y);
  const m = Number(s.m);
  if (s.cal === 's' && y >= 1986 && y <= 1991 && m >= 4 && m <= 9) {
    date = '这段时间中国实行夏令时。请照出生证上的钟表时间填写，我们会自动换算。';
  }
  if (s.cal === 'l' && s.y !== '') {
    const leap = lunar[y]?.find((x) => x.leap);
    if (leap) date = `农历 ${y} 年有${leap.label}，如出生在闰月请选「${leap.label}」。`;
  }
  let time: string | null = null;
  if (s.nohour) time = '不知道时辰也能排：只排年、月、日三柱，部分结论会标注可信度。';
  else if (s.hh === '23') time = '23:00–23:59 为晚子时：日柱仍算当天（本站采用早晚子时派）。';
  else if (s.hh === '0') time = '00:00–00:59 为早子时：日柱算当天（即已过午夜的这一天）。';
  return { date, time };
}

export interface FormErrors {
  date?: string;
  time?: string;
  gender?: string;
  place?: string;
  form?: string;
}

export function validate(s: FormState, lunar: LunarTable): FormErrors {
  const e: FormErrors = {};
  if (s.y === '' || s.m === '' || s.d === '') e.date = '请选择完整的出生日期。';
  else {
    const y = Number(s.y);
    const d = Number(s.d);
    if (s.cal === 's') {
      const m = Number(s.m);
      const t = new Date(Date.UTC(y, m - 1, d));
      if (t.getUTCMonth() !== m - 1) e.date = `该日期不存在，请核对（${m} 月没有 ${d} 日）。`;
    } else {
      const leap = s.m.startsWith('L');
      const m = Number(leap ? s.m.slice(1) : s.m);
      const mo = lunar[y]?.find((x) => x.m === m && x.leap === leap);
      if (!mo) e.date = '所选农历年份没有这个闰月，请核对是否为闰月。';
      else if (d > mo.days)
        e.date = `农历 ${y} 年${mo.label}是小月，只有二十九天，请核对出生日期。`;
    }
  }
  if (!s.nohour && (s.hh === '' || s.mm === ''))
    e.time = '请选择出生时间；不清楚可勾选「不知道」。';
  if (s.g === null) e.gender = '请选择性别';
  return e;
}

/** 校验通过后生成载荷（调用方先确认 validate 无错误） */
export function toPayload(s: FormState): PayloadV1 {
  const leap = s.cal === 'l' && s.m.startsWith('L');
  const m = Number(leap ? s.m.slice(1) : s.m);
  return {
    v: 1,
    c: s.cal,
    d: `${s.y}-${pad(m)}-${pad(Number(s.d))}`,
    lp: leap ? 1 : 0,
    t: s.nohour ? null : `${pad(Number(s.hh))}:${pad(Number(s.mm))}`,
    g: s.g ?? 'm',
    p: s.place?.code ?? null,
    j: null,
  };
}

/** 服务端错误码 → 表单上的位置（提示文字用服务端返回的 message，不回显输入） */
export function errorField(code: string): keyof FormErrors {
  if (code === 'E_DST_GAP') return 'time';
  if (code === 'E_UNKNOWN_PLACE' || code === 'E_INVALID_TIMEZONE' || code === 'E_INVALID_LONGITUDE')
    return 'place';
  if (/^E_(LUNAR_|DATE_|INVALID_DATETIME)/.test(code)) return 'date';
  return 'form';
}
