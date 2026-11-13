/**
 * 出生地选择接口 GET /api/places（TASKS T44；UI.md §4.2 出生地底部面板）。
 *
 * 出生地表约 518 KB，不整表下发到浏览器（HANDOFF 技术债）：面板每次只取一层或一页搜索结果。
 * - ?q=<关键词>：中文名 / 全拼 / 首字母搜索（core searchPlaces，最多 10 条）。
 * - ?parent=：逐层浏览。省略 → 省级列表（最后一组「海外 / 港澳台」）；P:<2 位> → 该省的地级 / 直辖县级；
 *   C:<4 位> → 该地级的区县（第一项是地级本身，供不确定区县时选）；OS → 港澳台与海外城市。
 * 出生地不是出生信息的敏感部分，但仍不写日志；响应可缓存（与用户无关）。
 */
import type { Logger } from 'pino';
import { listPlaces, searchPlaces, type Place } from '@zhiming/core/geo';
import { ApiError, handleApiError } from './errors';
import { clientIp, type RateLimiter } from './rate-limit';

export interface PlaceItem {
  /** 列表显示文字（本级名称；搜索结果为全称） */
  label: string;
  /** 可选中的出生地；纯分组（省、海外）为 null */
  place: { code: string; full: string; xinjiang: boolean } | null;
  /** 还有下一层时的 parent 参数 */
  next: string | null;
}

const OVERSEAS = 'OS';
const OVERSEAS_LABEL = '海外 / 港澳台';

interface Tree {
  provinces: PlaceItem[];
  children: Map<string, PlaceItem[]>;
}

let tree: Tree | null = null;

const isNumeric = (p: Place): boolean => /^\d{6}$/.test(p.code);
const isOverseas = (p: Place): boolean => !isNumeric(p) || /^(71|81|82)/.test(p.code);
const toSel = (p: Place): NonNullable<PlaceItem['place']> => ({
  code: p.code,
  full: p.name,
  xinjiang: p.code.startsWith('65'),
});
const strip = (full: string, prefix: string): string =>
  full.startsWith(prefix) && full.length > prefix.length ? full.slice(prefix.length) : full;

function buildTree(): Tree {
  const all = listPlaces();
  const children = new Map<string, PlaceItem[]>();
  const push = (k: string, it: PlaceItem): void => {
    const a = children.get(k);
    if (a) a.push(it);
    else children.set(k, [it]);
  };
  const byCode = new Map(all.map((p) => [p.code, p]));
  const provName = new Map<string, string>();
  for (const p of all) {
    if (!isNumeric(p) || isOverseas(p)) continue;
    const pp = p.code.slice(0, 2);
    if (p.level === 'municipality') provName.set(pp, p.name);
    else if (p.level === 'prefecture' && !provName.has(pp)) {
      // 地级全称 = 省名 + 本级名；本级名取自同前缀区县的全称不可靠，改用「省」「自治区」结尾截断
      const m = /^(.+?(?:省|自治区))/.exec(p.name);
      if (m?.[1]) provName.set(pp, m[1]);
    }
  }
  for (const p of all) {
    if (isOverseas(p)) {
      push(OVERSEAS, {
        label: isNumeric(p) ? p.name : p.name.replace(/^台湾(?=.)/, '台湾 '),
        place: toSel(p),
        next: null,
      });
      continue;
    }
    const pp = p.code.slice(0, 2);
    const pName = provName.get(pp) ?? '';
    if (p.level === 'municipality') continue;
    if (p.level === 'prefecture') {
      push(`P:${pp}`, {
        label: strip(p.name, pName),
        place: null,
        next: `C:${p.code.slice(0, 4)}`,
      });
      push(`C:${p.code.slice(0, 4)}`, {
        label: `${strip(p.name, pName)}（不确定区县）`,
        place: toSel(p),
        next: null,
      });
      continue;
    }
    const pref = byCode.get(`${p.code.slice(0, 4)}00`);
    const muni = byCode.get(`${pp}0000`);
    if (muni?.level === 'municipality') {
      push(`P:${pp}`, { label: strip(p.name, muni.name), place: toSel(p), next: null });
    } else if (pref?.level === 'prefecture') {
      push(`C:${p.code.slice(0, 4)}`, {
        label: strip(p.name, pref.name),
        place: toSel(p),
        next: null,
      });
    } else {
      // 省直辖县级行政单位（如仙桃市）：直接挂在省下
      push(`P:${pp}`, { label: strip(p.name, pName), place: toSel(p), next: null });
    }
  }
  const provinces: PlaceItem[] = [...provName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pp, name]) => ({ label: name, place: null, next: `P:${pp}` }));
  provinces.push({ label: OVERSEAS_LABEL, place: null, next: OVERSEAS });
  return { provinces, children };
}

export function browsePlaces(parent: string | null): PlaceItem[] | null {
  tree ??= buildTree();
  if (parent === null || parent === '') return tree.provinces;
  return tree.children.get(parent) ?? null;
}

export function searchPlaceItems(q: string): PlaceItem[] {
  return searchPlaces(q).map((p) => ({ label: p.name, place: toSel(p), next: null }));
}

export interface PlacesDeps {
  limiter: RateLimiter;
  logger: Logger;
}

export function handlePlaces(req: Request, deps: PlacesDeps): Response {
  try {
    if (!deps.limiter.hit(clientIp(req.headers))) throw new ApiError('E_RATE_LIMITED', 429);
    const url = new URL(req.url);
    const q = url.searchParams.get('q');
    let items: PlaceItem[] | null;
    if (q !== null) {
      if (q.length > 40) throw new ApiError('E_BAD_REQUEST', 400);
      items = searchPlaceItems(q);
    } else {
      const parent = url.searchParams.get('parent');
      if (parent !== null && parent !== '' && !/^(P:\d{2}|C:\d{4}|OS)$/.test(parent))
        throw new ApiError('E_BAD_REQUEST', 400);
      items = browsePlaces(parent);
      if (items === null) throw new ApiError('E_BAD_REQUEST', 404);
    }
    return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=3600' } });
  } catch (e) {
    return handleApiError(e, deps.logger, 'api/places');
  }
}
