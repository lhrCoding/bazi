/**
 * - 素材库：生产只读 texts-releases/ 发布快照（只收 approved），开发读 rules/texts 工作区；新订单 texts_version = 当前版本。
 *   首次使用即加载并校验，失败抛错（instrumentation.ts 在生产启动时预加载，失败即退出）。
 *
 * - DATABASE_PATH：SQLite 文件（默认 ./data/orders.db）。
 * - BIRTH_FP_KEY / BIRTH_FP_KEY_ID：指纹密钥（缺失即报错，不使用默认值）。
 * - PAYMENT_MODE：mock（开发 / 测试）| sandbox | live。**生产环境禁止 mock**。真实渠道在 T49–T51 接入。
 *   E2E 用生产构建（next start）跑 mock，需显式设 ALLOW_MOCK_PAYMENT=1（只在 playwright.config.ts 设置，部署时绝不能设）。
 * - SITE_URL：回调与返回地址的站点根（默认 http://localhost:3000）。
 * - 素材库：生产只读 texts-releases/ 发布快照（只收 approved），开发读 rules/texts 工作区；新订单 texts_version = 当前版本。
 *   首次使用即加载并校验，失败抛错（instrumentation.ts 在生产启动时预加载，失败即退出）。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadFpKey, type FpKey } from './birth-fp';
import { appLogger } from './log';
import { defaultRulesDir, loadReportResources, type ReportResources } from './report-resources';
import { loadTextsStore, type TextsStore } from './texts-store';
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
  texts: TextsStore;
  resources: ReportResources;
}

/** 订单里的 texts_version（整数）↔ 素材库键：0 = 开发工作区 'dev'，N = 发布快照 vN */
export const textsKeyOf = (v: number): string => (v === 0 ? 'dev' : String(v));
export const textsVersionOf = (key: string): number => (key === 'dev' ? 0 : Number(key));

export function createAppContext(env: NodeJS.ProcessEnv): AppContext {
  const mode = env.PAYMENT_MODE ?? 'mock';
  const prod = env.NODE_ENV === 'production' && env.ALLOW_MOCK_PAYMENT !== '1';
  if (mode === 'mock' && prod) throw new ConfigError('生产环境不允许 PAYMENT_MODE=mock');
  const siteUrl = env.SITE_URL || 'http://localhost:3000';
  const dbPath = env.DATABASE_PATH || join(process.cwd(), 'data', 'orders.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openOrdersDb(dbPath);
  const fpKey = loadFpKey({ BIRTH_FP_KEY: env.BIRTH_FP_KEY, BIRTH_FP_KEY_ID: env.BIRTH_FP_KEY_ID });
  const mock =
    mode === 'mock'
      ? createMockProvider({ siteUrl, autoPay: env.MOCK_PAYMENT_AUTO !== '0' })
      : null;
  const providers: AppContext['providers'] = mock ? { mock } : {};
  const rulesDir = defaultRulesDir(env);
  const texts = loadTextsStore(env, {
    releasesDir: join(process.cwd(), 'texts-releases'),
    workspaceDir: join(rulesDir, 'texts'),
  });
  const textsVersion = () => textsVersionOf(texts.current);
  return {
    db,
    fpKey,
    providers,
    mock,
    siteUrl,
    textsVersion,
    texts,
    resources: loadReportResources(rulesDir),
  };
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
