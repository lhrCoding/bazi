/**
 * T13：单次排盘性能（验收：p95 < 20 ms）。
 *
 * 测试方法：
 * - 输入：全部 cases.json 案例 + 固定种子伪随机生成的出生信息（1900–2100 年、公历 / 农历、有 / 无时辰、
 *   有 / 无出生地、交节选择），共 SAMPLE_COUNT 个，结果可复现；遇到夏令时不存在的时刻等合法错误则换下一个。
 * - 先预热 WARMUP 次（JIT、tyme4ts 内部缓存、Luxon 时区缓存），再对每个输入单独计时一次 computeChart
 *   （含输入 Zod 校验与输出 ChartSchema 校验），用 performance.now() 取耗时，统计 p50 / p95 / p99 / max。
 * - 输出运行环境（Node 版本、CPU 型号、核数、平台）与统计结果，便于不同机器对比。
 */
import { arch, cpus, platform, release } from 'node:os';
import { describe, expect, it } from 'vitest';
import { computeChart, type BirthInput } from '../src/index';
import { BaziError } from '../src/bazi/errors';
import { listPlaces } from '../src/geo';
import { loadCases } from './helpers/cases';

const REF = Date.parse('2026-10-30T00:00:00+08:00');
const SAMPLE_COUNT = 2000;
const WARMUP = 300;
const P95_LIMIT_MS = 20;

/** mulberry32：固定种子伪随机数，保证样本可复现 */
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

const pad = (n: number) => String(n).padStart(2, '0');

function randomInputs(n: number): BirthInput[] {
  const r = rng(20261030);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const places = [null, ...listPlaces().map((p) => p.code)];
  const out: BirthInput[] = [];
  while (out.length < n) {
    const lunar = r() < 0.2;
    const year = lunar ? int(1900, 2099) : int(1900, 2100);
    const month = int(1, 12);
    const day = lunar ? int(1, 29) : int(1, 28);
    const noHour = r() < 0.15;
    out.push({
      calendar: lunar ? 'lunar' : 'solar',
      date: `${year}-${pad(month)}-${pad(day)}`,
      ...(lunar ? { isLeapMonth: false } : {}),
      time: noHour ? null : `${pad(int(0, 23))}:${pad(int(0, 59))}`,
      gender: r() < 0.5 ? '男' : '女',
      placeCode: places[int(0, places.length - 1)] ?? null,
      jieqiChoice: noHour
        ? ((['before', 'after', 'unsure', null] as const)[int(0, 3)] ?? null)
        : null,
    });
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)] as number;
}

describe('computeChart 性能', () => {
  it(`单次排盘 p95 < ${P95_LIMIT_MS} ms`, () => {
    const inputs = [...loadCases().cases.map((c) => c.input), ...randomInputs(SAMPLE_COUNT)];
    const run = (inp: BirthInput): boolean => {
      try {
        computeChart(inp, REF);
        return true;
      } catch (e) {
        if (e instanceof BaziError) return false; // 夏令时不存在的时刻、超出范围等合法拒绝
        throw e;
      }
    };

    for (let i = 0; i < WARMUP; i++) run(inputs[i % inputs.length] as BirthInput);

    const times: number[] = [];
    let rejected = 0;
    for (const inp of inputs) {
      const t0 = performance.now();
      const ok = run(inp);
      const dt = performance.now() - t0;
      if (ok) times.push(dt);
      else rejected++;
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((s, x) => s + x, 0) / times.length;
    const stats = {
      samples: times.length,
      rejected,
      mean: mean.toFixed(3),
      p50: percentile(times, 50).toFixed(3),
      p95: percentile(times, 95).toFixed(3),
      p99: percentile(times, 99).toFixed(3),
      max: (times[times.length - 1] as number).toFixed(3),
    };
    const cpu = cpus()[0]?.model ?? 'unknown';
    console.info(
      [
        '',
        '======== computeChart 性能（毫秒）========',
        `环境：Node ${globalThis.process.version}，${platform()} ${release()} ${arch()}，${cpu} × ${cpus().length}`,
        `样本 ${stats.samples}（另有 ${stats.rejected} 个合法拒绝未计入），预热 ${WARMUP} 次`,
        `mean ${stats.mean} | p50 ${stats.p50} | p95 ${stats.p95} | p99 ${stats.p99} | max ${stats.max}`,
        '==========================================',
      ].join('\n'),
    );

    expect(times.length).toBeGreaterThan(SAMPLE_COUNT * 0.95);
    expect(percentile(times, 95)).toBeLessThan(P95_LIMIT_MS);
  });
});
