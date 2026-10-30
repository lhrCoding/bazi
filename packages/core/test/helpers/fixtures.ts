/**
 * 测试用 fixture 读取工具（约定见 test/fixtures/README.md）。
 * 只在测试中使用 Node IO；src/ 不得引用本文件。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** packages/core/test/fixtures 的绝对路径 */
export const FIXTURES_DIR = resolve(here, '../fixtures');

/** 仓库根目录下 rules/ 的绝对路径（命理专家维护，测试只读） */
export const RULES_DIR = resolve(here, '../../../../rules');

function safeJoin(base: string, rel: string): string {
  const full = resolve(base, rel);
  const r = relative(base, full);
  if (r.startsWith('..') || isAbsolute(r)) {
    throw new Error(`路径越界：${rel}`);
  }
  return full;
}

/** fixture 的绝对路径（相对 test/fixtures/，不允许越出该目录） */
export function fixturePath(rel: string): string {
  return safeJoin(FIXTURES_DIR, rel);
}

export function readFixtureText(rel: string): string {
  const p = fixturePath(rel);
  if (!existsSync(p)) throw new Error(`fixture 不存在：${rel}`);
  return readFileSync(p, 'utf8');
}

export function readFixtureJson<T = unknown>(rel: string): T {
  return JSON.parse(readFixtureText(rel)) as T;
}

/** 读取仓库 rules/ 下的文件（只读，不复制到 fixtures） */
export function readRulesFile(rel: string): string {
  return readFileSync(safeJoin(RULES_DIR, rel), 'utf8');
}
