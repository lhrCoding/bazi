/**
 * 进程内单例（TASKS T47）：订单库、指纹密钥、支付渠道、素材版本。首次使用时按环境变量初始化，配置错误立即抛出。
 *
 * - DATABASE_PATH：SQLite 文件（默认 ./data/orders.db）。
 * - BIRTH_FP_KEY / BIRTH_FP_KEY_ID：指纹密钥（缺失即报错，不使用默认值）。
 * - PAYMENT_MODE：mock（开发 / 测试）| sandbox | live。**生产环境禁止 mock**。真实渠道在 T49–T51 接入。
 *   E2E 用生产构建（next start）跑 mock，需显式设 ALLOW_MOCK_PAYMENT=1（只在 playwright.config.ts 设置，部署时绝不能设）。
 * - SITE_URL：回调与返回地址的站点根（默认 http://localhost:3000）。
 * - 素材版本：生产取 texts-releases/ 中最大的发布号；开发为 0（工作区素材）。T53 接入完整素材库后改为取 TextsStore.current。
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadFpKey, type FpKey } from './birth-fp';
import { appLogger } from './log';
import { openOrdersDb, type OrdersDb } from './orders';
import type { Channel } from './orders/schema';
import { createMockProvider, type MockProvider } from './payment/mock';
import type { PaymentProvider } from './payment/types';
import { createRateLimiter } from './rate-limit';
import type { OrdersDeps } from './orders-api';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface AppContext {
  db: OrdersDb;
  fpKey: FpKey;
  providers: Partial<Record<Channel, PaymentProvider>>;
  mock: MockProvider | null;
  siteUrl: string;
  textsVersion: () => number;
}

export function currentReleaseVersion(dir: string): number {
  try {
    const nums = readdirSync(dir)
      .map((f) => /^v(\d+)\.json$/.exec(f)?.[1])
      .filter((x): x is string => x !== undefined)
      .map(Number);
    return nums.length ? Math.max(...nums) : 0;
  } catch {
    return 0;
  }
}

export function createAppContext(env: NodeJS.ProcessEnv): AppContext {
  const mode = env.PAYMENT_MODE ?? 'mock';
  const prod = env.NODE_ENV === 'production' && env.ALLOW_MOCK_PAYMENT !== '1';
  if (mode === 'mock' && prod) throw new ConfigError('生产环境不允许 PAYMENT_MODE=mock');
  const siteUrl = env.SITE_URL || 'http://localhost:3000';
  const dbPath = env.DATABASE_PATH || join(process.cwd(), 'data', 'orders.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openOrdersDb(dbPath);
  const fpKey = loadFpKey({ BIRTH_FP_KEY: env.BIRTH_FP_KEY, BIRTH_FP_KEY_ID: env.BIRTH_FP_KEY_ID });
  const mock = mode === 'mock' ? createMockProvider({ siteUrl }) : null;
  const providers: AppContext['providers'] = mock ? { mock } : {};
  const releasesDir = join(process.cwd(), 'texts-releases');
  const textsVersion = () =>
    env.NODE_ENV === 'production' ? currentReleaseVersion(releasesDir) : 0;
  return { db, fpKey, providers, mock, siteUrl, textsVersion };
}

let ctx: AppContext | null = null;
export function appContext(): AppContext {
  ctx ??= createAppContext(process.env);
  return ctx;
}

const orderLimiter = createRateLimiter({
  limit: Number(process.env.ORDER_RATE_LIMIT) || 30,
  windowMs: 60_000,
});
const lastQuery = new Map<string, number>();

export function ordersDeps(): OrdersDeps {
  const c = appContext();
  return {
    db: c.db,
    fpKey: c.fpKey,
    textsVersion: c.textsVersion,
    providers: c.providers,
    limiter: orderLimiter,
    logger: appLogger(),
    now: Date.now,
    siteUrl: c.siteUrl,
    lastQuery,
  };
}
