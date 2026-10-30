/**
 * T12：节气边界、权威节气抽查、lunar-javascript 差分（ARCHITECTURE §测试 4–6，rules/calendar.md §1、§2、§3）。
 *
 * ① 1950–2050 年每个「节」前 / 后 1 分钟：月柱（立春含年柱）正好切换；并与 tyme4ts、lunar-javascript 比对。
 * ② 香港天文台公布的 2019–2028 年节气时刻（固定数据，来源见 fixture 文件头）：误差 ≤ 1 分钟。
 * ③ lunar-javascript 1.7.7（显式 setSect(2)，早晚子时派）随机时刻四柱比对，其中 ≥ 100 个落在 23:00–23:59。
 *
 * 注意：tyme4ts 与 lunar-javascript 同一作者、同一寿星天文历算法，③ 只能发现调用 / 移植错误；
 * 天文算法本身的独立核对靠 ②（香港天文台）与 cases.json。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Solar } from 'lunar-javascript';
import { describe, expect, it } from 'vitest';
import { solarTermMoment, tymePillarsAt } from '../src/bazi/calendar-adapter';
import { computeDayHour } from '../src/bazi/day-hour';
import { fromBeijingParts, toBeijingParts, type DateTimeParts } from '../src/bazi/time';
import { computeYearMonth, SUPPORTED_RANGE_UTC_MS } from '../src/bazi/year-month';
import { readFixtureJson } from './helpers/fixtures';

const MINUTE = 60_000;
const ZHI = '子丑寅卯辰巳午未申酉戌亥';

/** 确定性伪随机（mulberry32），保证每次运行同样的样本 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pillars {
  year: string;
  month: string;
  day: string;
  hour: string;
}

/** 本项目四柱（北京标准时间，不做真太阳时校正）：年月柱比节气绝对时刻，日时柱按早晚子时派。 */
function ourPillars(p: DateTimeParts): Pillars {
  const ym = computeYearMonth(fromBeijingParts(p));
  const dh = computeDayHour(p);
  return { year: ym.year, month: ym.month, day: dh.day, hour: dh.hour };
}

/** lunar-javascript 四柱：每次显式 setSect(2)，不依赖库默认值（calendar.md CAL-DH-ZI）。 */
function lunarPillars(p: DateTimeParts, sect: 1 | 2 = 2): Pillars {
  const ec = Solar.fromYmdHms(p.year, p.month, p.day, p.hour, p.minute, p.second)
    .getLunar()
    .getEightChar();
  ec.setSect(sect);
  if (ec.getSect() !== sect) throw new Error('lunar-javascript setSect 未生效');
  return { year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), hour: ec.getTime() };
}

const fmt = (p: DateTimeParts) =>
  `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
  `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
const show = (x: Pillars) => `${x.year} ${x.month} ${x.day} ${x.hour}`;

/** 1950–2050 年每个「节」（tyme4ts 序号 1、3 … 23）的交节绝对时刻 */
function jieMoments() {
  const out: { year: number; index: number; name: string; utcMs: number }[] = [];
  for (let y = 1950; y <= 2050; y++) {
    for (let i = 1; i <= 23; i += 2) {
      const j = solarTermMoment(y, i);
      out.push({ year: y, index: i, name: j.name, utcMs: j.utcMs });
    }
  }
  return out;
}

describe('① 节气边界：1950–2050 年每个「节」前 / 后 1 分钟', () => {
  const jies = jieMoments();

  it('共 101 年 × 12 个节 = 1,212 个交节点', () => {
    expect(jies).toHaveLength(1212);
  });

  it('月柱切换、月支连续 +1；立春年柱切换、其余节年柱不变；jieqi_prev / next 正确', () => {
    for (const jie of jies) {
      const before = computeYearMonth(jie.utcMs - MINUTE);
      const after = computeYearMonth(jie.utcMs + MINUTE);
      const where = `${jie.year} ${jie.name}`;
      expect(after.jieqi_prev.name, where).toBe(jie.name);
      expect(before.jieqi_next.name, where).toBe(jie.name);
      expect(after.jieqi_prev.time, where).toBe(before.jieqi_next.time);
      expect(after.month, where).not.toBe(before.month);
      const zb = ZHI.indexOf(before.month[1] as string);
      const za = ZHI.indexOf(after.month[1] as string);
      expect((zb + 1) % 12, where).toBe(za);
      if (jie.name === '立春') expect(after.year, where).not.toBe(before.year);
      else expect(after.year, where).toBe(before.year);
    }
  });

  it('前后 1 分钟的年柱、月柱与 tyme4ts（Sect2）一致', () => {
    const bad: string[] = [];
    for (const jie of jies) {
      for (const t of [jie.utcMs - MINUTE, jie.utcMs + MINUTE]) {
        const ours = computeYearMonth(t);
        const theirs = tymePillarsAt(toBeijingParts(t));
        if (ours.year !== theirs.year || ours.month !== theirs.month) {
          bad.push(
            `${fmt(toBeijingParts(t))} ${jie.name} 本项目 ${ours.year}${ours.month} / tyme ${theirs.year}${theirs.month}`,
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('前后 1 分钟的四柱与 lunar-javascript（setSect(2)）一致', () => {
    const bad: string[] = [];
    for (const jie of jies) {
      for (const t of [jie.utcMs - MINUTE, jie.utcMs + MINUTE]) {
        const p = toBeijingParts(t);
        const ours = ourPillars(p);
        const theirs = lunarPillars(p);
        if (show(ours) !== show(theirs)) {
          bad.push(`${fmt(p)} ${jie.name} 本项目 ${show(ours)} / lunar ${show(theirs)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------- ② 香港天文台节气时刻 ----------

interface HkoFixture {
  source: string;
  source_page: string;
  source_data_url_pattern: string;
  retrieved: string;
  timezone: string;
  years: Record<string, string[]>;
}

const HKO_FILE = 'hko-solar-terms/hko-2019-2028.json';
const hko = readFixtureJson<HkoFixture>(HKO_FILE);

/** 'YYYY-MM-DD HH:MM 名称'（香港时间 = UTC+8）→ { name, utcMs } */
function parseHkoRow(row: string): { name: string; utcMs: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) (\S+)$/.exec(row);
  if (!m) throw new Error(`HKO 行格式错误：${row}`);
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number) as number[];
  return {
    name: m[6] as string,
    utcMs: fromBeijingParts({
      year: year as number,
      month: month as number,
      day: day as number,
      hour: hour as number,
      minute: minute as number,
      second: 0,
    }),
  };
}

describe('② 香港天文台 2019–2028 年节气时刻抽查（误差 ≤ 1 分钟）', () => {
  const years = Object.keys(hko.years).map(Number);

  it('fixture 文件头注明来源 URL、取数日期与时区；10 年 × 24 个节气', () => {
    expect(hko.source_page).toMatch(/^https:\/\/www\.hko\.gov\.hk\//);
    expect(hko.source_data_url_pattern).toMatch(/^https:\/\/www\.hko\.gov\.hk\/.*\{YEAR\}\.xml$/);
    expect(hko.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hko.timezone).toContain('UTC+8');
    expect(years).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028]);
    for (const y of years) expect(hko.years[y], String(y)).toHaveLength(24);
  });

  // fixture 每年按 小寒 … 冬至 排列，第 k 行（0 起）对应 tyme4ts 序号 k + 1。
  // 冬至（第 24 行）不参与：本项目只用当年序号 1–23（冬至是中气、不影响年月柱，适配层不暴露它）。
  it('小寒 … 大雪 共 230 个节气：名称一致，本项目节气时刻与天文台相差 ≤ 60 秒', () => {
    const bad: string[] = [];
    let n = 0;
    let maxDiffSec = 0;
    for (const y of years) {
      const rows = hko.years[y] as string[];
      for (let k = 0; k < 23; k++) {
        const row = rows[k] as string;
        const h = parseHkoRow(row);
        const ours = solarTermMoment(y, k + 1);
        const diffSec = (ours.utcMs - h.utcMs) / 1000;
        maxDiffSec = Math.max(maxDiffSec, Math.abs(diffSec));
        n++;
        if (ours.name !== h.name || Math.abs(diffSec) > 60) {
          bad.push(`${row}：本项目 ${ours.name} 差 ${diffSec} 秒`);
        }
      }
    }
    expect(n).toBe(230);
    expect(bad).toEqual([]);
    expect(maxDiffSec).toBeLessThanOrEqual(60);
  });

  it('以天文台公布的「节」时刻为准，前 / 后 1 分钟月柱切换（立春含年柱）', () => {
    const bad: string[] = [];
    for (const y of years) {
      const rows = hko.years[y] as string[];
      for (let k = 0; k < 23; k += 2) {
        const h = parseHkoRow(rows[k] as string);
        const before = computeYearMonth(h.utcMs - MINUTE);
        const after = computeYearMonth(h.utcMs + MINUTE);
        const zb = ZHI.indexOf(before.month[1] as string);
        const za = ZHI.indexOf(after.month[1] as string);
        const yearOk = h.name === '立春' ? after.year !== before.year : after.year === before.year;
        if ((zb + 1) % 12 !== za || !yearOk || after.jieqi_prev.name !== h.name) {
          bad.push(`${rows[k]}：前 ${before.year}${before.month} / 后 ${after.year}${after.month}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------- ③ lunar-javascript 差分 ----------

describe('③ lunar-javascript 1.7.7（setSect(2)）四柱差分', () => {
  it('依赖锁定：devDependency 精确版本 1.7.7、MIT 许可证；不在 dependencies', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.['lunar-javascript']).toBe('1.7.7');
    expect(pkg.dependencies?.['lunar-javascript']).toBeUndefined();
    const require = createRequire(import.meta.url);
    const libPkg = require('lunar-javascript/package.json') as { version: string; license: string };
    expect(libPkg.version).toBe('1.7.7');
    expect(libPkg.license).toBe('MIT');
  });

  it('packages/ 与 apps/ 下只有 packages/core/test/ 中的文件 import / require lunar-javascript', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(name)) out.push(full);
      }
      return out;
    };
    const pattern =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]lunar-javascript(?:\/[^'"]*)?['"]/;
    const offenders = [...walk(join(repoRoot, 'packages')), ...walk(join(repoRoot, 'apps'))]
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(repoRoot, f))
      .filter((f) => !f.startsWith('packages/core/test/'));
    expect(offenders).toEqual([]);
  });

  it('C05 确认库的实际行为：1995-03-15 23:30 setSect(2) → 乙巳日戊子时；setSect(1) → 丙午日戊子时', () => {
    const p = { year: 1995, month: 3, day: 15, hour: 23, minute: 30, second: 0 };
    expect(lunarPillars(p, 2)).toMatchObject({ day: '乙巳', hour: '戊子' });
    expect(lunarPillars(p, 1)).toMatchObject({ day: '丙午', hour: '戊子' });
    expect(ourPillars(p)).toMatchObject({ day: '乙巳', hour: '戊子' });
  });

  it('1900–2100 随机 1,200 个时刻 + 200 个 23:00–23:59 + 100 个 00:00–00:59：四柱全部一致', () => {
    const r = rng(12_2026_1030);
    const { min, max } = SUPPORTED_RANGE_UTC_MS;
    // 留出两端 2 天，避免改时分后越出支持范围
    const lo = min + 2 * 86_400_000;
    const hi = max - 2 * 86_400_000;
    const randomParts = () => toBeijingParts(lo + Math.floor((r() * (hi - lo)) / 1000) * 1000);

    const samples: DateTimeParts[] = [];
    for (let i = 0; i < 1200; i++) samples.push(randomParts());
    for (let i = 0; i < 200; i++) {
      samples.push({
        ...randomParts(),
        hour: 23,
        minute: Math.floor(r() * 60),
        second: Math.floor(r() * 60),
      });
    }
    for (let i = 0; i < 100; i++) {
      samples.push({
        ...randomParts(),
        hour: 0,
        minute: Math.floor(r() * 60),
        second: Math.floor(r() * 60),
      });
    }

    expect(samples.length).toBeGreaterThanOrEqual(1000);
    expect(samples.filter((p) => p.hour === 23).length).toBeGreaterThanOrEqual(100);

    const bad: string[] = [];
    for (const p of samples) {
      const ours = ourPillars(p);
      const theirs = lunarPillars(p);
      if (show(ours) !== show(theirs)) {
        bad.push(`${fmt(p)} 本项目 ${show(ours)} / lunar ${show(theirs)}`);
      }
    }
    // 不一致样例打印出来人工核对（ARCHITECTURE §测试 6）
    if (bad.length > 0)
      console.error(`lunar-javascript 差分不一致 ${bad.length} 例：\n${bad.join('\n')}`);
    expect(bad).toEqual([]);
  });
});
