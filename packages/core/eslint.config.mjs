// packages/core 的 ESLint 配置。
// 边界规则（ARCHITECTURE 第 4 节）：core 是纯计算包，不得依赖 Next / React / Node 内置模块 / 数据库 / 支付。
// 允许的第三方依赖只有：tyme4ts、luxon、zod、@noble/hashes。
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const nodeBuiltins = builtinModules.filter((m) => !m.startsWith('_'));

const restrictedPatterns = [
  {
    group: ['node:*'],
    message: 'core 不得使用 Node 内置模块（必须能在浏览器和 Node 中同样运行）。',
  },
  {
    group: nodeBuiltins.flatMap((m) => [m, `${m}/*`]),
    message: 'core 不得使用 Node 内置模块（必须能在浏览器和 Node 中同样运行）。',
  },
  {
    group: ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'core 不得依赖 Next / React，界面相关代码放 apps/web。',
  },
  {
    group: [
      'better-sqlite3',
      'sqlite3',
      'drizzle-orm',
      'drizzle-orm/*',
      'drizzle-kit',
      'pg',
      'mysql2',
      'prisma',
      '@prisma/*',
    ],
    message: 'core 不得访问数据库，订单存储放 apps/web/server/orders。',
  },
  {
    group: ['alipay-sdk', 'alipay-sdk/*', 'wechatpay*', '*wechatpay*', '*wxpay*'],
    message: 'core 不得包含支付代码，支付放 apps/web/server/payment。',
  },
  {
    group: ['pino', 'pino/*'],
    message: 'core 不写日志，日志放 apps/web/server/log.ts。',
  },
];

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictedPatterns }],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'core 不读取环境变量与进程信息。' },
        { name: 'Buffer', message: 'core 不使用 Node Buffer，用 Uint8Array。' },
        { name: 'require', message: 'core 只用 ESM import。' },
        { name: 'fetch', message: 'core 不做网络 IO。' },
      ],
    },
  },
  {
    // 配置文件本身运行在 Node 中，可以使用 node:module
    files: ['eslint.config.mjs'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // 测试与 Vitest 配置运行在 Node 中，可用 Node 内置模块读取 fixture（约定见 test/fixtures/README.md）。
    // Next / React / 数据库 / 支付 / 日志 的禁令在测试中照样生效；src/ 不受此放宽影响。
    files: ['test/**', 'vitest.config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: restrictedPatterns.filter((p) => !p.message.includes('Node 内置模块')) },
      ],
    },
  },
  prettier,
);
