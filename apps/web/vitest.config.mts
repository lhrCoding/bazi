import { defineConfig } from 'vitest/config';

// web 层单元测试（Route Handler 逻辑、server/ 模块等）。组件 / 浏览器测试走 Playwright（T64）。
export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
    retry: 0,
  },
});
