/**
 * T40 出生地经纬度与时区表。
 * 验收：覆盖全部省级（直辖市 / 港澳台）、地级、区县级单位（数量与民政部 2024 年代码一致）；抽查 10 个城市经度误差 ≤ 0.05°；
 * 许可证说明存在；代码只增不删（与基准清单比对）；按名称 / 拼音前缀搜索。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IANAZone } from 'luxon';
import { describe, expect, it } from 'vitest';
import { findPlace, listPlaces, PLACES_SOURCE_DATE, searchPlaces } from '../src/geo';

const places = listPlaces();
const count = (level: string): number => places.filter((p) => p.level === level).length;

describe('覆盖与数量（民政部 2024 年县以上行政区划代码）', () => {
  it('县级 2,846、地级 333、直辖市 4、港澳台 3；台湾 / 海外城市若干', () => {
    expect(count('county')).toBe(2846);
    expect(count('prefecture')).toBe(333);
    expect(
      places
        .filter((p) => p.level === 'municipality')
        .map((p) => p.code)
        .sort(),
    ).toEqual(['110000', '120000', '310000', '500000']);
    expect(
      places
        .filter((p) => p.level === 'region')
        .map((p) => p.code)
        .sort(),
    ).toEqual(['710000', '810000', '820000']);
    expect(count('city')).toBeGreaterThanOrEqual(40);
  });

  it('每个县级代码的省级前缀都存在（34 个省级单位全覆盖）；不直接收录普通省份', () => {
    const provinces = new Set(
      places.filter((p) => p.level === 'county').map((p) => p.code.slice(0, 2)),
    );
    expect(provinces.size).toBe(31); // 内地 31 个省级单位（港澳台另列）
    expect(findPlace('440000')).toBeNull();
    expect(findPlace('650000')).toBeNull();
  });

  it('T06 临时表的代码在正式表中继续有效', () => {
    for (const c of ['110000', '310000', '440100', '230100', '540100', '650100'])
      expect(findPlace(c), c).not.toBeNull();
  });
});

describe('精度：抽查 10 个城市（与 GeoNames cities15000 独立比对，误差 ≤ 0.05°）', () => {
  // [区划代码, 城区, GeoNames id, GeoNames 经度]（中心城区 ↔ GeoNames 城市点，2026-11-13 下载）
  const REF: [string, string, string, number][] = [
    ['110101', '北京市东城区', '1816670', 116.39723],
    ['310101', '上海市黄浦区', '1796236', 121.45806],
    ['440104', '广州市越秀区', '1809858', 113.25],
    ['510104', '成都市锦江区', '1815286', 104.06667],
    ['420102', '武汉市江岸区', '1791247', 114.26667],
    ['610103', '西安市碑林区', '1790630', 108.92861],
    ['330102', '杭州市上城区', '1808926', 120.16142],
    ['230102', '哈尔滨市道里区', '2037013', 126.65],
    ['540102', '拉萨市城关区', '1280737', 91.1],
    ['530102', '昆明市五华区', '1804651', 102.71833],
  ];
  for (const [code, name, gid, lon] of REF) {
    it(`${name}（GeoNames ${gid}）`, () => {
      const p = findPlace(code);
      expect(p?.name).toContain(name.slice(-3));
      expect(Math.abs((p?.longitude ?? 0) - lon)).toBeLessThanOrEqual(0.05);
    });
  }
});

describe('字段与时区', () => {
  it('代码唯一；经度 0.01° 精度且在合理范围；内地 Asia/Shanghai、港澳台各自时区、海外为有效 IANA 时区', () => {
    expect(new Set(places.map((p) => p.code)).size).toBe(places.length);
    for (const p of places) {
      expect(Math.round(p.longitude * 100) / 100, p.code).toBe(p.longitude);
      if (/^\d{6}$/.test(p.code) && !['710000', '810000', '820000'].includes(p.code)) {
        expect(p.timezone, p.code).toBe('Asia/Shanghai');
        expect(p.longitude, p.code).toBeGreaterThan(73);
        expect(p.longitude, p.code).toBeLessThan(136);
      }
    }
    expect(findPlace('810000')?.timezone).toBe('Asia/Hong_Kong');
    expect(findPlace('820000')?.timezone).toBe('Asia/Macau');
    expect(findPlace('710000')?.timezone).toBe('Asia/Taipei');
    // 用 luxon 校验（Node 的 Intl 时区列表只收旧名，如 Asia/Saigon 而非 Asia/Ho_Chi_Minh）
    for (const p of places)
      expect(IANAZone.isValidZone(p.timezone), `${p.code} ${p.timezone}`).toBe(true);
  });

  it('新疆用北京时间（calendar.md §5）；低精度条目已标记', () => {
    expect(findPlace('650102')?.timezone).toBe('Asia/Shanghai');
    expect(places.filter((p) => p.lowPrecision).length).toBeGreaterThan(0);
    expect(findPlace('632801')?.lowPrecision).toBe(false); // 格尔木：多数簇（市区驻地）
    expect(Math.abs((findPlace('632801')?.longitude ?? 0) - 94.9)).toBeLessThan(0.05);
  });
});

describe('许可与来源说明', () => {
  it('生成文件头写明民政部、Wikidata CC0、GeoNames CC BY 4.0、pinyin-pro MIT 与下载日期', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/geo/places.data.ts', import.meta.url)),
      'utf8',
    ).slice(0, 2000);
    for (const s of ['民政部', 'Wikidata', 'CC0', 'GeoNames', 'CC BY 4.0', 'pinyin-pro', 'MIT'])
      expect(src).toContain(s);
    expect(PLACES_SOURCE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('代码只增不删', () => {
  it('基准清单中的每个代码在当前表中仍存在', () => {
    const base = readFileSync(
      fileURLToPath(new URL('./fixtures/place-codes.txt', import.meta.url)),
      'utf8',
    )
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(base.length).toBeGreaterThanOrEqual(3229);
    const missing = base.filter((c) => findPlace(c) === null);
    expect(missing).toEqual([]);
  });
});

describe('搜索（首页出生地输入框）', () => {
  const names = (q: string, n?: number) => searchPlaces(q, n).map((p) => p.name);
  it('中文名前缀：海淀 → 北京市海淀区', () => {
    expect(names('海淀')[0]).toBe('北京市海淀区');
  });
  it('全拼与首字母，不区分大小写', () => {
    expect(names('haidian')[0]).toBe('北京市海淀区');
    expect(names('HaiDian')[0]).toBe('北京市海淀区');
    expect(names('hd', 50)).toContain('北京市海淀区');
  });
  it('多音字地名：chongqing → 重庆市；luan → 六安市；panyu → 番禺区', () => {
    expect(names('chongqing')).toContain('重庆市');
    expect(names('luan', 50).some((n) => n.endsWith('六安市'))).toBe(true);
    expect(names('panyu')[0]).toBe('广东省广州市番禺区');
  });
  it('重名区县都列出（朝阳区：北京、长春）；全称包含（广州市天河）', () => {
    const r = names('朝阳区');
    expect(r).toContain('北京市朝阳区');
    expect(r).toContain('吉林省长春市朝阳区');
    expect(names('广州市天河')).toEqual(['广东省广州市天河区']);
  });
  it('海外与港澳台：东京、温哥华、香港', () => {
    expect(names('东京')).toEqual(['日本东京']);
    expect(names('wengehua')).toEqual(['加拿大温哥华']);
    expect(names('香港')[0]).toBe('香港特别行政区');
  });
  it('空串、只有空白、无结果、limit', () => {
    expect(searchPlaces('')).toEqual([]);
    expect(searchPlaces('   ')).toEqual([]);
    expect(searchPlaces('不存在的地名')).toEqual([]);
    expect(searchPlaces('qu', 3)).toHaveLength(3);
  });
  it('只差「市 / 县 / 区」后缀算完全匹配：dongguan → 东莞市（地级、不设区县）排在东光县之前；东莞 → 东莞市', () => {
    expect(searchPlaces('dongguan', 5)[0]?.code).toBe('441900');
    expect(searchPlaces('东莞', 5)[0]?.code).toBe('441900');
  });
  it('同为完全匹配时县级排在地级之前（朝阳：北京市朝阳区在辽宁省朝阳市之前）', () => {
    const r = searchPlaces('朝阳', 10).map((p) => p.level);
    expect(r.indexOf('county')).toBeLessThan(r.indexOf('prefecture'));
  });
});
