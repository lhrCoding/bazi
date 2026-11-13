/**
 * 生成出生地表 packages/core/src/geo/places.data.ts（TASKS T40）。
 *
 * 用法：npx tsx scripts/geo/build-places.ts <原始数据目录> <下载日期 YYYY-MM-DD>
 * 原始数据目录需包含（不进仓库，按下面方式下载）：
 *   mca2024.html     民政部《2024 年中华人民共和国县以上行政区划代码》
 *                    https://www.mca.gov.cn/mzsj/xzqh/2025/202401xzqh.html（政府公开信息，事实数据）
 *   six.csv          Wikidata：P442（中国行政区划代码）6 位 + P625 坐标（CC0）
 *   upper.csv        Wikidata：P442 2 位 / 4 位（省级 / 地级）+ P625 坐标（CC0）
 *   cities15000.txt  GeoNames cities15000（CC BY 4.0，需署名）https://download.geonames.org/export/dump/
 * Wikidata 查询见 scripts/geo/README.md。
 *
 * 取舍规则：
 * - 名单以民政部为准：县级 2,846 + 地级 333（城市点）+ 直辖市 4 + 港澳台 3 + 台湾主要城市 + 海外常用城市。
 * - 内地经度取 Wikidata P625。一个代码有多个坐标时：若有 ≥ 2 个点彼此相差 < 0.05°，取这一簇的均值（多数）；
 *   否则取全部点均值并标 lowPrecision（列在 README，待人工对照地图修正）。
 * - 时区：内地一律 Asia/Shanghai（新疆出生证一般记北京时间，calendar.md §5）；港 Asia/Hong_Kong、澳 Asia/Macau、
 *   台 Asia/Taipei；海外取 GeoNames 时区字段。
 * - 拼音由 pinyin-pro（MIT）在构建时生成，运行时不依赖它。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';

const [rawDir, downloaded] = process.argv.slice(2);
if (!rawDir || !downloaded || !/^\d{4}-\d{2}-\d{2}$/.test(downloaded)) {
  console.error('用法：npx tsx scripts/geo/build-places.ts <原始数据目录> <下载日期 YYYY-MM-DD>');
  process.exit(2);
}
const read = (f: string): string => readFileSync(join(rawDir, f), 'utf8');

// ---------- 民政部 ----------
const mca = new Map<string, string>();
for (const row of read('mca2024.html').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...(row[1] as string).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) =>
      (m[1] as string)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, '')
        .replace(/[\s　]/g, ''),
    )
    .filter(Boolean);
  const i = cells.findIndex((c) => /^\d{6}$/.test(c));
  if (i >= 0 && cells[i + 1])
    mca.set(cells[i] as string, (cells[i + 1] as string).replace(/\*$/, ''));
}

// ---------- Wikidata ----------
function wikidataPoints(file: string): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  const lines = read(file).trim().split('\n').slice(1);
  for (const line of lines) {
    const code = /,([\d ]+),/.exec(line)?.[1]?.replace(/ /g, '');
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(line);
    if (!code || !m) continue;
    const list = out.get(code) ?? [];
    const p: [number, number] = [Number(m[1]), Number(m[2])];
    if (!list.some((q) => q[0] === p[0] && q[1] === p[1])) list.push(p);
    out.set(code, list);
  }
  return out;
}
const six = wikidataPoints('six.csv');
const upper = wikidataPoints('upper.csv');

/** 多数簇均值；没有多数则全体均值并标低精度 */
function resolveLon(points: [number, number][]): { lon: number; low: boolean } {
  if (points.length === 1) return { lon: (points[0] as [number, number])[0], low: false };
  for (const p of points) {
    const cluster = points.filter(
      (q) => Math.abs(q[0] - p[0]) < 0.05 && Math.abs(q[1] - p[1]) < 0.05,
    );
    if (cluster.length >= 2 && cluster.length > points.length / 2) {
      return { lon: cluster.reduce((s, q) => s + q[0], 0) / cluster.length, low: false };
    }
  }
  const lons = points.map((q) => q[0]);
  const spread = Math.max(...lons) - Math.min(...lons);
  return { lon: lons.reduce((s, x) => s + x, 0) / lons.length, low: spread >= 0.05 };
}

// ---------- GeoNames ----------
interface GnCity {
  id: string;
  ascii: string;
  country: string;
  lon: number;
  pop: number;
  tz: string;
}
const gn: GnCity[] = read('cities15000.txt')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .map((f) => ({
    id: f[0] as string,
    ascii: f[2] as string,
    country: f[8] as string,
    lon: Number(f[5]),
    pop: Number(f[14]),
    tz: f[17] as string,
  }));
function gnFind(ascii: string, country: string): GnCity {
  const hits = gn
    .filter((c) => c.ascii === ascii && c.country === country)
    .sort((a, b) => b.pop - a.pop);
  if (!hits[0]) throw new Error(`GeoNames 找不到 ${ascii} (${country})`);
  return hits[0];
}

// ---------- 组装 ----------
export interface PlaceRow {
  code: string;
  name: string;
  full: string;
  level: 'county' | 'prefecture' | 'municipality' | 'region' | 'city';
  lon: number;
  tz: string;
  py: string;
  pyi: string;
  low?: true;
}
const rows: PlaceRow[] = [];
const py = (s: string): { py: string; pyi: string } => {
  const arr = pinyin(s, { toneType: 'none', type: 'array', nonZh: 'removed' }) as string[];
  return { py: arr.join(''), pyi: arr.map((x) => x[0]).join('') };
};
const round2 = (x: number): number => Math.round(x * 100) / 100;
const lowList: string[] = [];
const derivedList: string[] = [];
const MUNICIPALITIES = ['110000', '120000', '310000', '500000'];
const REGIONS: Record<string, string> = {
  '710000': 'Asia/Taipei',
  '810000': 'Asia/Hong_Kong',
  '820000': 'Asia/Macau',
};

for (const [code, name] of mca) {
  const prov = mca.get(`${code.slice(0, 2)}0000`) ?? '';
  const prefCode = `${code.slice(0, 4)}00`;
  const pref = code.slice(2, 4) !== '90' && prefCode !== code ? (mca.get(prefCode) ?? '') : '';
  if (code.endsWith('0000')) {
    if (!MUNICIPALITIES.includes(code) && !REGIONS[code]) continue; // 普通省份不作为出生地
    const pts = upper.get(code.slice(0, 2));
    if (!pts) throw new Error(`Wikidata 缺 ${code} ${name}`);
    const r = resolveLon(pts);
    const low = r.low || code === '710000'; // 台湾省整体取岛中心，精度低；另列台湾主要城市
    if (low) lowList.push(`${code} ${name}`);
    rows.push({
      code,
      name,
      full: name,
      level: REGIONS[code] ? 'region' : 'municipality',
      lon: round2(r.lon),
      tz: REGIONS[code] ?? 'Asia/Shanghai',
      ...py(name),
      ...(low ? { low: true as const } : {}),
    });
    continue;
  }
  const isPref = code.endsWith('00');
  let pts = isPref ? upper.get(code.slice(0, 4)) : six.get(code);
  if (!pts && isPref) {
    // 地级在 Wikidata 无坐标（2026-11 仅海东市）：取辖下代码最小的区县（通常为驻地区，海东市驻乐都区）
    const seat = [...mca.keys()]
      .filter((k) => k.slice(0, 4) === code.slice(0, 4) && k !== code)
      .sort()[0];
    pts = seat ? six.get(seat) : undefined;
    if (pts) derivedList.push(`${code} ${name} ← ${seat} ${mca.get(seat as string)}`);
  }
  if (!pts) throw new Error(`Wikidata 缺 ${code} ${name}`);
  const r = resolveLon(pts);
  if (r.low) lowList.push(`${code} ${name}`);
  rows.push({
    code,
    name,
    full: `${prov}${isPref ? '' : pref}${name}`,
    level: isPref ? 'prefecture' : 'county',
    lon: round2(r.lon),
    tz: 'Asia/Shanghai',
    ...py(name),
    ...(r.low ? { low: true as const } : {}),
  });
}

// 台湾主要城市与海外常用城市（中文名为通行译名；坐标、时区取自 GeoNames，代码 X-<geonameid>）
const EXTRA: [string, string, string, string][] = [
  ['Taipei', 'TW', '台北市', '台湾'],
  ['New Taipei City', 'TW', '新北市', '台湾'],
  ['Taichung', 'TW', '台中市', '台湾'],
  ['Tainan', 'TW', '台南市', '台湾'],
  ['Kaohsiung', 'TW', '高雄市', '台湾'],
  ['New York City', 'US', '纽约', '美国'],
  ['Los Angeles', 'US', '洛杉矶', '美国'],
  ['San Francisco', 'US', '旧金山', '美国'],
  ['Seattle', 'US', '西雅图', '美国'],
  ['Chicago', 'US', '芝加哥', '美国'],
  ['Boston', 'US', '波士顿', '美国'],
  ['Houston', 'US', '休斯敦', '美国'],
  ['Vancouver', 'CA', '温哥华', '加拿大'],
  ['Toronto', 'CA', '多伦多', '加拿大'],
  ['Montreal', 'CA', '蒙特利尔', '加拿大'],
  ['London', 'GB', '伦敦', '英国'],
  ['Manchester', 'GB', '曼彻斯特', '英国'],
  ['Paris', 'FR', '巴黎', '法国'],
  ['Berlin', 'DE', '柏林', '德国'],
  ['Frankfurt am Main', 'DE', '法兰克福', '德国'],
  ['Amsterdam', 'NL', '阿姆斯特丹', '荷兰'],
  ['Madrid', 'ES', '马德里', '西班牙'],
  ['Rome', 'IT', '罗马', '意大利'],
  ['Moscow', 'RU', '莫斯科', '俄罗斯'],
  ['Sydney', 'AU', '悉尼', '澳大利亚'],
  ['Melbourne', 'AU', '墨尔本', '澳大利亚'],
  ['Brisbane', 'AU', '布里斯班', '澳大利亚'],
  ['Perth', 'AU', '珀斯', '澳大利亚'],
  ['Auckland', 'NZ', '奥克兰', '新西兰'],
  ['Singapore', 'SG', '新加坡', '新加坡'],
  ['Kuala Lumpur', 'MY', '吉隆坡', '马来西亚'],
  ['George Town', 'MY', '槟城', '马来西亚'],
  ['Bangkok', 'TH', '曼谷', '泰国'],
  ['Jakarta', 'ID', '雅加达', '印度尼西亚'],
  ['Manila', 'PH', '马尼拉', '菲律宾'],
  ['Ho Chi Minh City', 'VN', '胡志明市', '越南'],
  ['Hanoi', 'VN', '河内', '越南'],
  ['Tokyo', 'JP', '东京', '日本'],
  ['Osaka', 'JP', '大阪', '日本'],
  ['Seoul', 'KR', '首尔', '韩国'],
  ['Dubai', 'AE', '迪拜', '阿联酋'],
  ['Sao Paulo', 'BR', '圣保罗', '巴西'],
  ['Johannesburg', 'ZA', '约翰内斯堡', '南非'],
];
for (const [ascii, cc, name, country] of EXTRA) {
  const c = gnFind(ascii, cc);
  rows.push({
    code: `X-${c.id}`,
    name,
    full: `${country}${name === country ? '' : name}`,
    level: 'city',
    lon: round2(c.lon),
    tz: c.tz,
    ...py(name),
  });
}

const counts = {
  county: rows.filter((r) => r.level === 'county').length,
  prefecture: rows.filter((r) => r.level === 'prefecture').length,
};
if (counts.county !== 2846 || counts.prefecture !== 333)
  throw new Error(`数量不符：${JSON.stringify(counts)}`);

const header = `/**
 * 出生地表（生成文件，勿手改；由 scripts/geo/build-places.ts 生成，说明见 scripts/geo/README.md）。
 *
 * 数据来源与许可（下载日期 ${downloaded}）：
 * - 名单与名称：民政部《2024 年中华人民共和国县以上行政区划代码》（政府公开信息）：县级 2,846、地级 333。
 * - 内地与港澳台经度：Wikidata（CC0 1.0，公有领域）P442 中国行政区划代码 + P625 坐标。
 * - 台湾主要城市与海外城市的经度、时区：GeoNames cities15000（CC BY 4.0，https://www.geonames.org/，需署名）。
 * - 拼音：构建时由 pinyin-pro（MIT）生成。
 * 精度：经度四舍五入到 0.01°；low = true 的条目在来源中有相互矛盾的坐标，取均值，待人工修正（共 ${lowList.length} 条）。
 * 规则：代码只增不删（test/places.test.ts 与上一版本比对）。
 */
import type { PlaceRow } from './types';

export const PLACES_SOURCE_DATE = '${downloaded}';

// 以 JSON 字符串内嵌后解析：避免 TypeScript 对 3,000 余项字面量做类型推断（TS2590），解析也更快
export const PLACE_ROWS: readonly PlaceRow[] = JSON.parse(${JSON.stringify(JSON.stringify(rows))}) as PlaceRow[];
`;
const out = join(import.meta.dirname, '../../packages/core/src/geo/places.data.ts');
writeFileSync(out, header);
writeFileSync(
  join(import.meta.dirname, 'low-precision.txt'),
  `# 来源坐标相互矛盾、取均值的低精度条目（待人工对照地图修正）\n${lowList.join('\n')}\n` +
    `# 地级在 Wikidata 无坐标、改用驻地区县坐标的条目\n${derivedList.map((x) => `# ${x}`).join('\n')}\n`,
);
console.log(
  `写出 ${rows.length} 条（县级 ${counts.county}、地级 ${counts.prefecture}、低精度 ${lowList.length}）→ ${out}`,
);
