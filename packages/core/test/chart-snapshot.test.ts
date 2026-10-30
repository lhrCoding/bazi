/**
 * T13：Chart 快照（ARCHITECTURE §3.4 第 7 条：engineVersion 不变时快照不变）。
 *
 * - 快照集 = 全部 cases.json 案例 + 若干补充输入（海外 / 夏令时重复时刻 / 三柱交节前后 / 农历闰月 / 近时辰边界），
 *   refDate 固定为毫秒时间戳。
 * - 两层保护：
 *   1) Vitest 快照（__snapshots__/chart-snapshot.test.ts.snap）：输出有任何变化都会显示差异；
 *   2) 版本摘要表（fixtures/engine-version-digests.json）：ENGINE_VERSION → 快照集 JSON 的 SHA-256。
 *      同一版本号只能对应一份输出；仅用 `vitest -u` 更新快照而不提升版本号，第 2 层仍然失败。
 * - 引擎输出确实需要变化时：提升 src/bazi/version.ts 的 ENGINE_VERSION → `vitest -u` 更新快照 →
 *   把测试失败信息里给出的新摘要追加到摘要表（旧版本条目保留，便于追溯）。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeChart, ENGINE_VERSION, type BirthInput } from '../src/index';
import { loadCases } from './helpers/cases';
import { readFixtureJson } from './helpers/fixtures';

/** 2026-10-30 00:00 北京时间 */
const REF = 1_793_289_600_000;

const base = (o: Partial<BirthInput>): BirthInput => ({
  calendar: 'solar',
  date: '2000-01-01',
  time: '12:00',
  gender: '男',
  placeCode: null,
  jieqiChoice: null,
  ...o,
});

/** 补充输入（cases.json 未覆盖的输出分支） */
const EXTRA: Record<string, BirthInput> = {
  'X01 夏令时结束日重复时刻 01:30（取较晚一次）': base({ date: '1990-09-16', time: '01:30' }),
  'X02 未校正且接近时辰边界 10:50': base({ date: '2005-08-08', time: '10:50', gender: '女' }),
  'X03 拉萨已校正 + 晚子时附近': base({ date: '1979-12-31', time: '23:59', placeCode: '540100' }),
  'X04 农历闰月（2023 闰二月初一）': base({
    calendar: 'lunar',
    date: '2023-02-01',
    isLeapMonth: true,
    time: '06:00',
  }),
  'X05 三柱 C19 当天选交节前': base({ date: '2024-02-04', time: null, jieqiChoice: 'before' }),
  'X06 三柱 C19 当天选交节后': base({ date: '2024-02-04', time: null, jieqiChoice: 'after' }),
  'X07 三柱 出生地上海、女': base({
    date: '2010-10-10',
    time: null,
    gender: '女',
    placeCode: '310000',
  }),
  'X08 1900 年初（支持范围起点附近）': base({ date: '1900-01-31', time: '08:00' }),
  'X09 2100 年末（支持范围终点附近）': base({ date: '2100-12-31', time: '22:00', gender: '女' }),
};

function snapshotSet(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of loadCases().cases) out[`${c.id} ${c.title}`] = computeChart(c.input, REF);
  for (const [k, input] of Object.entries(EXTRA)) out[k] = computeChart(input, REF);
  return out;
}

describe('Chart 快照', () => {
  const set = snapshotSet();
  const digest = createHash('sha256').update(JSON.stringify(set)).digest('hex');

  it('refDate 常量与北京时间 2026-10-30 00:00 一致', () => {
    expect(REF).toBe(Date.parse('2026-10-30T00:00:00+08:00'));
  });

  it('快照集整体（含 engineVersion）与已提交快照一致', () => {
    expect(set).toMatchSnapshot();
  });

  it('同一 ENGINE_VERSION 只对应一份输出摘要（改了输出必须提升版本号）', () => {
    const table = readFixtureJson<Record<string, string>>('engine-version-digests.json');
    const recorded = table[ENGINE_VERSION];
    expect(
      recorded,
      `摘要表缺少 ${ENGINE_VERSION}；确认输出变化是有意的之后，追加 "${ENGINE_VERSION}": "${digest}"`,
    ).toBeDefined();
    expect(
      digest,
      `ENGINE_VERSION ${ENGINE_VERSION} 的输出摘要变了：请提升 src/bazi/version.ts 的版本号，` +
        `更新快照，并追加新版本摘要 ${digest}`,
    ).toBe(recorded);
  });
});
