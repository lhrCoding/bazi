/**
 * 浏览器端到端测试（T44 起；T64 完善）。
 * 本机 macOS 12 不被 Playwright 自带内核支持，改用系统已安装的 Chrome（channel: 'chrome'）；
 * CI（Linux）可改为自带 chromium。视口按 iPhone 13 模拟（触屏、390×844、DPR 3）。
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3107;
const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'off' },
  projects: [{ name: 'iphone', use: { ...iphone, channel: process.env.PW_CHANNEL ?? 'chrome' } }],
  webServer: {
    // 服务进程的 stdout / stderr 同时写入 .e2e-logs/server.log，供日志哨兵测试（T60）检查
    command: `mkdir -p .e2e-logs && : > .e2e-logs/server.log && (npx next build && npx next start -p ${PORT} -H 127.0.0.1) 2>&1 | tee -a .e2e-logs/server.log`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    // 测试专用：放宽限流、mock 支付（生产构建需显式 ALLOW_MOCK_PAYMENT）、一次性指纹密钥与临时订单库
    env: {
      CHART_RATE_LIMIT: '10000',
      ORDER_RATE_LIMIT: '10000',
      PAYMENT_MODE: 'mock',
      ALLOW_MOCK_PAYMENT: '1',
      TEXTS_DEV_WORKSPACE: '1',
      REPORT_RATE_LIMIT: '10000',
      BIRTH_FP_KEY: 'e2e0'.repeat(16),
      BIRTH_FP_KEY_ID: 'e2e',
      DATABASE_PATH: 'test-results/e2e-orders.db',
      SITE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
