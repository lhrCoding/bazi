import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from '../src/index';
import { FIXTURES_DIR, fixturePath, readFixtureJson, readRulesFile } from './helpers/fixtures';

describe('core 测试基础设施（T02 示例）', () => {
  it('能导入 core 公开入口', () => {
    expect(CORE_PACKAGE).toBe('@zhiming/core');
  });

  it('按约定读取 fixtures', () => {
    const data = readFixtureJson<{ ganzhi_cycle_start: string; tiangan: string[] }>(
      'examples/sample.json',
    );
    expect(data.ganzhi_cycle_start).toBe('甲子');
    expect(data.tiangan).toHaveLength(10);
  });

  it('fixture 路径不允许越出 fixtures 目录', () => {
    expect(fixturePath('examples/sample.json').startsWith(FIXTURES_DIR)).toBe(true);
    expect(() => fixturePath('../../package.json')).toThrow('路径越界');
  });

  it('能只读访问仓库 rules/cases.json', () => {
    const raw = readRulesFile('cases.json');
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });
});
