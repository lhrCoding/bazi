/**
 * SQLite 连接与迁移（TASKS T42；ARCHITECTURE §5.2）。
 * - 文件库开 WAL（单进程写、毫秒级），busy_timeout 5 秒，外键开启。
 * - 迁移：migrations/NNNN_*.sql 按文件名顺序执行，已执行的记录在 schema_migrations；每个文件在一个事务里执行，重复调用幂等。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export type OrdersDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function runMigrations(sqlite: Database.Database, dir = MIGRATIONS_DIR): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const done = new Set(
    (sqlite.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(f, Date.now());
    })();
    applied.push(f);
  }
  return applied;
}

/** 打开数据库并执行迁移。path = ':memory:' 用于测试。 */
export function openOrdersDb(path: string): OrdersDb {
  const sqlite = new Database(path);
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  return drizzle({ client: sqlite, schema }) as OrdersDb;
}
