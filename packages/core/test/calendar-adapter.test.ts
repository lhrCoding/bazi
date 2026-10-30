/**
 * T04：历法适配层（calendar-adapter.ts）。
 * - provider 必须显式设置为 Sect2（早晚子时、按分钟起运），不依赖库默认值（calendar.md §3.3、§8）。
 * - 只有 calendar-adapter.ts 可以 import tyme4ts。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { providerInfo, solarTermMoment, tymePillarsAt } from '../src/bazi/calendar-adapter';
import { formatBeijing } from '../src/bazi/time';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');

describe('tyme4ts provider', () => {
  it('模块加载后两个 provider 都是 Sect2', () => {
    expect(providerInfo()).toEqual({
      eightChar: 'LunarSect2EightCharProvider',
      childLimit: 'LunarSect2ChildLimitProvider',
      isSect2: true,
    });
  });

  it('C05 锁定：1995-03-15 23:30 → 乙巳日戊子时（晚子时日柱不换、时干按次日起）', () => {
    const p = tymePillarsAt({ year: 1995, month: 3, day: 15, hour: 23, minute: 30, second: 0 });
    expect(p).toEqual({ year: '乙亥', month: '己卯', day: '乙巳', hour: '戊子' });
  });

  it('C04：1995-03-15 00:30 → 乙巳日丙子时（早子时）', () => {
    const p = tymePillarsAt({ year: 1995, month: 3, day: 15, hour: 0, minute: 30, second: 0 });
    expect(p).toEqual({ year: '乙亥', month: '己卯', day: '乙巳', hour: '丙子' });
  });
});

describe('节气时刻', () => {
  it('2024 年立春 16:27（C01 / C02 的交节点，北京标准时间）', () => {
    const t = solarTermMoment(2024, 3);
    expect(t.name).toBe('立春');
    expect(t.year).toBe(2024);
    expect(formatBeijing(t.utcMs).slice(0, 16)).toBe('2024-02-04 16:27');
  });

  it('2023 年清明 09:13（C07 的交节点）', () => {
    const t = solarTermMoment(2023, 7);
    expect(t.name).toBe('清明');
    expect(formatBeijing(t.utcMs).slice(0, 16)).toBe('2023-04-05 09:13');
  });

  it('fromIndex 年份约定：序号 1 为当年 1 月小寒，序号 23 为当年 12 月大雪', () => {
    expect(solarTermMoment(2000, 1).name).toBe('小寒');
    expect(formatBeijing(solarTermMoment(2000, 1).utcMs).slice(0, 7)).toBe('2000-01');
    expect(solarTermMoment(2000, 23).name).toBe('大雪');
    expect(formatBeijing(solarTermMoment(2000, 23).utcMs).slice(0, 7)).toBe('2000-12');
  });

  it('非法序号报错', () => {
    expect(() => solarTermMoment(2000, 0)).toThrow();
    expect(() => solarTermMoment(2000, 24)).toThrow();
    expect(() => solarTermMoment(2000, 1.5)).toThrow();
  });
});

describe('tyme4ts 只在适配层中 import', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('packages/ 与 apps/ 下除 calendar-adapter.ts 外没有文件 import / require tyme4ts', () => {
    const files = [...walk(join(REPO_ROOT, 'packages')), ...walk(join(REPO_ROOT, 'apps'))];
    const pattern =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]tyme4ts(?:\/[^'"]*)?['"]/;
    const offenders = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(REPO_ROOT, f));
    expect(offenders).toEqual(['packages/core/src/bazi/calendar-adapter.ts']);
  });

  it('其他文件不得改写 tyme4ts 的 provider', () => {
    const files = [...walk(join(REPO_ROOT, 'packages')), ...walk(join(REPO_ROOT, 'apps'))];
    const offenders = files
      .filter((f) => !f.endsWith('calendar-adapter.test.ts'))
      .filter((f) => /\b(?:LunarHour|ChildLimit)\.provider\s*=/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(REPO_ROOT, f));
    expect(offenders).toEqual(['packages/core/src/bazi/calendar-adapter.ts']);
  });
});
