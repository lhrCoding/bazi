import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from '@zhiming/core';

describe('web 测试基础设施（T02 示例）', () => {
  it('能通过 workspace 依赖导入 @zhiming/core', () => {
    expect(CORE_PACKAGE).toBe('@zhiming/core');
  });
});
