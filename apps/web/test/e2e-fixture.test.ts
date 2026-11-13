/**
 * E2E 用的案例载荷夹具（e2e/cases.fixture.json）与 rules/cases.json 保持同步。
 * Playwright 不能直接加载 core 的测试辅助（用了 import.meta），所以由这里生成；不一致时测试失败。
 * 重新生成：UPDATE_E2E_FIXTURE=1 npx vitest run test/e2e-fixture.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { birthInputToPayload, encodePayload } from '@zhiming/core/birth';
import { loadCases } from '../../../packages/core/test/helpers/cases';

const FILE = fileURLToPath(new URL('../e2e/cases.fixture.json', import.meta.url));

it('e2e/cases.fixture.json 与 cases.json 一致', () => {
  const rows = loadCases().cases.map((c) => ({
    id: c.id,
    payload: encodePayload(birthInputToPayload(c.input)),
    hourKnown: c.input.time !== null,
  }));
  const json = `${JSON.stringify(rows, null, 2)}\n`;
  if (process.env.UPDATE_E2E_FIXTURE) writeFileSync(FILE, json);
  expect(readFileSync(FILE, 'utf8')).toBe(json);
});
