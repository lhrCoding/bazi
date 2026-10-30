import { defineConfig } from 'vitest/config';

// core 是纯计算包：测试只跑在 Node 环境，不需要 DOM。
export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 同样输入永远同样输出：测试之间不共享可变状态，失败不重试
    retry: 0,
  },
});
