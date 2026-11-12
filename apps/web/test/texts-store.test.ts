/**
 * T38 服务端素材快照加载。
 * 验收：启动校验失败时进程退出并给出原因；生产只含 approved；必需槽位有兜底；开发模式加载 rules/texts（dev）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SLOTS } from '@zhiming/core/report';
import type { Snapshot, TextEntry } from '@zhiming/core/texts';
import {
  initTextsStoreOrExit,
  loadReleases,
  loadTextsStore,
  parseAllowedStatus,
  TextsStoreError,
} from '../server/texts-store';

const WORKSPACE = fileURLToPath(new URL('../../../rules/texts/', import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** 每个必需素材 / 固定文本槽位一条兜底的最小合法快照 */
function minimalSnapshot(version: number): Snapshot {
  const entries: TextEntry[] = SLOTS.filter((s) => s.required && s.source !== 'code').map((s) => ({
    id: `${s.id}-FALLBACK`,
    slot: s.id,
    when: {},
    asserts: [],
    priority: 0,
    fallback: s.source === 'material',
    requires_hour: false,
    length: [1, 300],
    variants: ['【测试素材】兜底'],
    status: 'approved',
    author: 'test',
    reviewer: '用户（T、2026-11-12）',
    updated: '2026-11-12',
  }));
  return {
    format: 1,
    textsVersion: version,
    rulesVersion: 'abcd1234',
    releasedAt: '2026-11-12',
    entries,
  };
}
function releasesDir(files: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), 'texts-releases-'));
  dirs.push(d);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(d, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return d;
}
const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TextsStoreError) return [...e.problems];
    throw e;
  }
  return [];
};

describe('生产：加载全部发布快照', () => {
  it('v1、v2 都加载；current = 最大版本号', () => {
    const d = releasesDir({ 'v1.json': minimalSnapshot(1), 'v2.json': minimalSnapshot(2) });
    const s = loadReleases(d);
    expect([...s.libraries.keys()].sort()).toEqual(['1', '2']);
    expect(s.current).toBe('2');
  });

  it('校验失败各给出原因：非 approved、缺兜底、文件名与版本不一致、格式错误、坏 JSON、空目录', () => {
    const notApproved = minimalSnapshot(1);
    (notApproved.entries[0] as TextEntry).status = 'draft';
    const missing = minimalSnapshot(2);
    missing.entries = missing.entries.filter((e) => e.slot !== 'CH1-MONTH');
    const p = problemsOf(() =>
      loadReleases(
        releasesDir({
          'v1.json': notApproved,
          'v2.json': missing,
          'v3.json': minimalSnapshot(4),
          'v5.json': { format: 1 },
          'v6.json': '{坏',
          'notes.json': {},
        }),
      ),
    );
    expect(p.some((x) => x.startsWith('v1.json：含非 approved 条目 CH1-DAYMASTER-FALLBACK'))).toBe(
      true,
    );
    expect(p).toContain('v2.json：CH1-MONTH：必需槽位没有兜底条目');
    expect(p).toContain('v3.json：textsVersion 4 与文件名不一致');
    expect(p.some((x) => x.startsWith('v5.json：快照格式不合法'))).toBe(true);
    expect(p.some((x) => x.startsWith('v6.json：JSON 解析失败'))).toBe(true);
    expect(p).toContain('notes.json：文件名应为 v{N}.json');
    expect(problemsOf(() => loadReleases(releasesDir({})))[0]).toMatch(/没有任何素材发布快照/);
  });

  it('生产环境 TEXTS_ALLOWED_STATUS 只能是 approved', () => {
    const d = releasesDir({ 'v1.json': minimalSnapshot(1) });
    const both = { releasesDir: d, workspaceDir: WORKSPACE };
    expect(loadTextsStore({ NODE_ENV: 'production' }, both).current).toBe('1');
    expect(
      problemsOf(() =>
        loadTextsStore({ NODE_ENV: 'production', TEXTS_ALLOWED_STATUS: 'approved,reviewed' }, both),
      ),
    ).toEqual(['生产环境 TEXTS_ALLOWED_STATUS 只能是 approved']);
  });
});

describe('启动：失败即退出并给出原因', () => {
  it('initTextsStoreOrExit 打印原因、以 1 退出', () => {
    const logs: string[] = [];
    let code: number | null = null;
    const exit = (c: number): never => {
      code = c;
      throw new Error('exit');
    };
    const d = releasesDir({});
    expect(() =>
      initTextsStoreOrExit(
        { NODE_ENV: 'production' },
        { releasesDir: d, workspaceDir: WORKSPACE },
        exit,
        (m) => logs.push(m),
      ),
    ).toThrow('exit');
    expect(code).toBe(1);
    expect(logs[0]).toMatch(/素材库加载失败[\s\S]*没有任何素材发布快照/);
  });
});

describe('开发：直接加载 rules/texts 工作区', () => {
  it("texts_version = 'dev'；TEXTS_ALLOWED_STATUS 默认 draft + reviewed + approved，可收窄；非法值报错", () => {
    const s = loadTextsStore(
      { NODE_ENV: 'development' },
      { releasesDir: '/nonexistent', workspaceDir: WORKSPACE },
    );
    expect(s.current).toBe('dev');
    expect(s.libraries.get('dev')?.bySlot.get('CH1-DAYMASTER')?.length).toBeGreaterThan(0);
    expect(parseAllowedStatus(undefined)).toEqual(['draft', 'reviewed', 'approved']);
    expect(parseAllowedStatus('approved, reviewed')).toEqual(['approved', 'reviewed']);
    expect(() => parseAllowedStatus('approved,retired')).toThrow(TextsStoreError);
    const approvedOnly = loadTextsStore(
      { NODE_ENV: 'development', TEXTS_ALLOWED_STATUS: 'approved' },
      { releasesDir: '/nonexistent', workspaceDir: WORKSPACE },
    );
    expect(approvedOnly.libraries.get('dev')?.bySlot.size).toBe(0);
  });
});
