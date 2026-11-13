/**
 * T44 首页表单逻辑与出生地接口。
 * 验收（单元部分）：闰月下拉按年份出现、非法日期有提示、23:00 / 00:xx / 不知道时辰都能生成载荷、载荷能被服务端解码。
 */
import { describe, expect, it } from 'vitest';
import { lunarMonthsOf } from '@zhiming/core';
import { decodePayload, encodePayload } from '@zhiming/core/birth';
import {
  EMPTY_FORM,
  errorField,
  hints,
  hourOptions,
  keepMonth,
  monthOptions,
  toPayload,
  validate,
  yearOptions,
  type FormState,
  type LunarTable,
} from '../app/birth-form-logic';
import { browsePlaces, handlePlaces, searchPlaceItems } from '../server/places-api';
import { createLogger } from '../server/log';
import { createRateLimiter } from '../server/rate-limit';
import { Writable } from 'node:stream';

const LUNAR: LunarTable = Object.fromEntries(
  [1990, 1995, 2001, 2023, 2024].map((y) => [
    y,
    lunarMonthsOf(y).map((o) => ({ m: o.month, leap: o.isLeap, label: o.label, days: o.dayCount })),
  ]),
);
const base: FormState = { ...EMPTY_FORM, y: '1995', m: '6', d: '15', hh: '13', mm: '47', g: 'f' };

describe('下拉选项', () => {
  it('年份倒序到 1930；时辰 24 项且标早晚子', () => {
    const y = yearOptions(2026);
    expect(y[0]).toEqual(['2026', '2026年']);
    expect(y.at(-1)).toEqual(['1930', '1930年']);
    const h = hourOptions();
    expect(h).toHaveLength(24);
    expect(h[0]?.[1]).toBe('00 时 · 子（早子）');
    expect(h[1]?.[1]).toBe('01 时 · 丑');
    expect(h[23]?.[1]).toBe('23 时 · 子（晚子）');
  });
  it('农历闰月按年份出现：2023 有闰二月，2024 没有', () => {
    const s23 = monthOptions({ ...base, cal: 'l', y: '2023' }, LUNAR);
    expect(s23).toHaveLength(13);
    expect(s23[2]).toEqual(['L2', '闰二月']);
    expect(monthOptions({ ...base, cal: 'l', y: '2024' }, LUNAR)).toHaveLength(12);
    expect(monthOptions(base, LUNAR)[0]).toEqual(['1', '1月']);
  });
  it('换年后闰月不存在则清空月份', () => {
    expect(keepMonth({ ...base, cal: 'l', y: '2024', m: 'L2' }, LUNAR).m).toBe('');
    expect(keepMonth({ ...base, cal: 'l', y: '2023', m: 'L2' }, LUNAR).m).toBe('L2');
  });
});

describe('情境提示', () => {
  it('夏令时、闰月、晚子 / 早子、不知道时辰', () => {
    expect(hints({ ...base, y: '1988', m: '7' }, LUNAR).date).toMatch(/夏令时/);
    expect(hints({ ...base, y: '1992', m: '7' }, LUNAR).date).toBeNull();
    expect(hints({ ...base, cal: 'l', y: '2023' }, LUNAR).date).toBe(
      '农历 2023 年有闰二月，如出生在闰月请选「闰二月」。',
    );
    expect(hints({ ...base, hh: '23' }, LUNAR).time).toMatch(/^23:00–23:59 为晚子时/);
    expect(hints({ ...base, hh: '0' }, LUNAR).time).toMatch(/^00:00–00:59 为早子时/);
    expect(hints({ ...base, nohour: true, hh: '23' }, LUNAR).time).toMatch(/^不知道时辰也能排/);
  });
});

describe('校验', () => {
  it('非法日期：公历 2 月 30 日、农历小月三十、不存在的闰月', () => {
    expect(validate({ ...base, m: '2', d: '30' }, LUNAR).date).toBe(
      '该日期不存在，请核对（2 月没有 30 日）。',
    );
    expect(validate({ ...base, m: '2', d: '29', y: '1995' }, LUNAR).date).toBeDefined();
    const small = LUNAR[2024]?.find((x) => x.days === 29);
    expect(
      validate({ ...base, cal: 'l', y: '2024', m: String(small?.m), d: '30' }, LUNAR).date,
    ).toMatch(/小月/);
    expect(validate({ ...base, cal: 'l', y: '2024', m: 'L2', d: '1' }, LUNAR).date).toMatch(/闰月/);
  });
  it('缺性别、缺时间就地提示；不知道时辰不要求时分', () => {
    const e = validate({ ...base, g: null, hh: '' }, LUNAR);
    expect(e.gender).toBe('请选择性别');
    expect(e.time).toBeDefined();
    expect(validate({ ...base, hh: '', mm: '', nohour: true }, LUNAR)).toEqual({});
  });
  it('错误码 → 字段', () => {
    expect(errorField('E_DST_GAP')).toBe('time');
    expect(errorField('E_LUNAR_NO_LEAP')).toBe('date');
    expect(errorField('E_UNKNOWN_PLACE')).toBe('place');
    expect(errorField('E_RATE_LIMITED')).toBe('form');
  });
});

describe('载荷', () => {
  const cases: [string, FormState][] = [
    ['公历', base],
    ['农历闰月', { ...base, cal: 'l', y: '2023', m: 'L2', d: '30' }],
    ['23:00', { ...base, hh: '23', mm: '0' }],
    ['00:30', { ...base, hh: '0', mm: '30' }],
    ['不知道时辰', { ...base, nohour: true, hh: '13' }],
    [
      '出生地',
      { ...base, place: { code: '650100', full: '新疆维吾尔自治区乌鲁木齐市', xinjiang: true } },
    ],
  ];
  for (const [name, s] of cases) {
    it(`${name}：可编码、服务端可解码`, () => {
      const p = toPayload(s);
      const d = decodePayload(encodePayload(p));
      expect(d.ok).toBe(true);
      if (d.ok) expect(d.payload).toEqual(p);
    });
  }
  it('字段值', () => {
    expect(toPayload({ ...base, cal: 'l', y: '2023', m: 'L2', d: '5' })).toMatchObject({
      c: 'l',
      d: '2023-02-05',
      lp: 1,
    });
    expect(toPayload({ ...base, hh: '0', mm: '5' }).t).toBe('00:05');
    expect(toPayload({ ...base, nohour: true }).t).toBeNull();
  });
});

describe('出生地接口', () => {
  const deps = () => ({
    limiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    logger: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
  });
  const get = (qs: string) =>
    handlePlaces(new Request(`http://localhost/api/places?${qs}`), deps());

  it('逐层浏览：省份（含海外组）→ 地级 → 区县', () => {
    const prov = browsePlaces(null) ?? [];
    expect(prov).toHaveLength(32);
    expect(prov.at(-1)).toMatchObject({ label: '海外 / 港澳台', next: 'OS' });
    expect(browsePlaces('P:11')?.find((x) => x.label === '海淀区')?.place?.code).toBe('110108');
    expect(browsePlaces('P:44')?.find((x) => x.label === '广州市')?.next).toBe('C:4401');
    const gz = browsePlaces('C:4401') ?? [];
    expect(gz[0]).toMatchObject({ label: '广州市（不确定区县）', place: { code: '440100' } });
    expect(gz.find((x) => x.label === '天河区')?.place?.full).toBe('广东省广州市天河区');
    expect(browsePlaces('P:42')?.find((x) => x.label === '仙桃市')?.place).not.toBeNull();
    expect(browsePlaces('OS')?.some((x) => x.label === '香港特别行政区')).toBe(true);
  });
  it('新疆条目带标记；搜索拼音', () => {
    expect(browsePlaces('C:6501')?.every((x) => x.place?.xinjiang)).toBe(true);
    expect(searchPlaceItems('wlmq').map((x) => x.place?.code)).toContain('650100');
    expect(searchPlaceItems('海淀')[0]?.label).toBe('北京市海淀区');
  });
  it('每层结果都远小于整表（不整表下发）', async () => {
    for (const qs of ['', 'parent=', 'parent=P:44', 'parent=C:4401', 'parent=OS', 'q=g']) {
      const r = await get(qs);
      expect(r.status).toBe(200);
      expect((await r.text()).length).toBeLessThan(20_000);
    }
  });
  it('非法参数 → 400 / 404', async () => {
    expect((await get('parent=xx')).status).toBe(400);
    expect((await get('parent=P:99')).status).toBe(404);
    expect((await get(`q=${'a'.repeat(41)}`)).status).toBe(400);
  });
});
