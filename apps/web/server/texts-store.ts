/**
 * 素材库快照加载（只在服务端；TASKS T38，ARCHITECTURE §4.3.8）。
 *
 * - 生产：加载 apps/web/texts-releases/ 下全部 v{N}.json（订单按自己的 texts_version 重看，旧快照永久保留）。
 *   每个快照校验：格式（SnapshotSchema）、文件名与 textsVersion 一致、只含 approved、必需槽位都有兜底
 *   （assertLibraryComplete）。任一失败 → TextsStoreError（列出文件与原因）。
 * - 开发：直接加载 rules/texts 工作区，texts_version = 'dev'，允许的状态由 TEXTS_ALLOWED_STATUS 配置（默认全部草稿可见），
 *   不要求必需槽位齐全（素材尚在撰写）。
 * - initTextsStoreOrExit：启动时调用，失败即打印原因并退出进程（ARCHITECTURE「必需槽位没有兜底 = 进程拒绝启动」）。
 *   接入 Next 启动流程（instrumentation）放在 T53 报告 API：目前尚无发布快照，过早接入会让生产无法启动。
 * 快照只在服务端读取，不放 public/、不被客户端组件 import。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertLibraryComplete,
  createLibrary,
  TextLibraryError,
  type TextLibrary,
  type TextStatus,
} from '@zhiming/core/report';
import { SnapshotSchema, TEXT_STATUSES } from '@zhiming/core/texts';
import { parseTextsFiles } from '@zhiming/core/texts/yaml';

export class TextsStoreError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`素材库加载失败：\n  ${problems.join('\n  ')}`);
    this.name = 'TextsStoreError';
  }
}

export interface TextsStore {
  /** texts_version（'1'、'2'… 或开发模式 'dev'）→ 素材库 */
  libraries: ReadonlyMap<string, TextLibrary>;
  /** 新订单使用的版本（最大发布号；开发模式为 'dev'） */
  current: string;
}

const SNAPSHOT_FILE = /^v(\d+)\.json$/;

export function loadReleases(dir: string): TextsStore {
  const problems: string[] = [];
  const libraries = new Map<string, TextLibrary>();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const m = SNAPSHOT_FILE.exec(f);
    if (!m) {
      problems.push(`${f}：文件名应为 v{N}.json`);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      problems.push(`${f}：JSON 解析失败（${(e as Error).message}）`);
      continue;
    }
    const parsed = SnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(
        `${f}：快照格式不合法（${parsed.error.issues[0]?.path.join('.')}：${parsed.error.issues[0]?.message}）`,
      );
      continue;
    }
    const s = parsed.data;
    if (String(s.textsVersion) !== m[1])
      problems.push(`${f}：textsVersion ${s.textsVersion} 与文件名不一致`);
    const notApproved = s.entries.filter((e) => e.status !== 'approved').map((e) => e.id);
    if (notApproved.length > 0)
      problems.push(`${f}：含非 approved 条目 ${notApproved.slice(0, 5).join('、')}`);
    try {
      const lib = createLibrary(s.entries, ['approved']);
      assertLibraryComplete(lib);
      libraries.set(String(s.textsVersion), lib);
    } catch (e) {
      if (!(e instanceof TextLibraryError)) throw e;
      problems.push(...e.problems.map((p) => `${f}：${p}`));
    }
  }
  if (problems.length === 0 && libraries.size === 0)
    problems.push(`${dir} 中没有任何素材发布快照（先运行 npm run texts:release）`);
  if (problems.length > 0) throw new TextsStoreError(problems);
  const current = String(Math.max(...[...libraries.keys()].map(Number)));
  return { libraries, current };
}

/** TEXTS_ALLOWED_STATUS：逗号分隔，如 "approved,reviewed"；未设置时开发模式默认全部草稿可见 */
export function parseAllowedStatus(raw: string | undefined): TextStatus[] {
  if (!raw || raw.trim() === '') return ['draft', 'reviewed', 'approved'];
  const list = raw.split(',').map((s) => s.trim());
  const bad = list.filter(
    (s) => !(TEXT_STATUSES as readonly string[]).includes(s) || s === 'retired',
  );
  if (bad.length > 0)
    throw new TextsStoreError([`TEXTS_ALLOWED_STATUS 含非法状态：${bad.join('、')}`]);
  return list as TextStatus[];
}

export function loadWorkspace(textsDir: string, allowed: readonly TextStatus[]): TextsStore {
  const files = readdirSync(textsDir)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml' && f !== 'glossary.yaml')
    .map((file) => ({ file, source: readFileSync(join(textsDir, file), 'utf8') }));
  const lib = createLibrary(parseTextsFiles(files), allowed);
  return { libraries: new Map([['dev', lib]]), current: 'dev' };
}

export interface TextsStoreEnv {
  NODE_ENV?: string | undefined;
  TEXTS_ALLOWED_STATUS?: string | undefined;
  /** 仅 E2E：生产构建（next start）下改读工作区草稿。部署时绝不能设（HANDOFF 上线检查） */
  TEXTS_DEV_WORKSPACE?: string | undefined;
}

/**
 * 按环境加载：production 只读发布快照（且生产只允许 approved：TEXTS_ALLOWED_STATUS 若设置必须为 approved）；
 * 其余环境读 rules/texts 工作区。
 */
export function loadTextsStore(
  env: TextsStoreEnv,
  dirs: { releasesDir: string; workspaceDir: string },
): TextsStore {
  if (env.NODE_ENV === 'production' && env.TEXTS_DEV_WORKSPACE !== '1') {
    const allowed = env.TEXTS_ALLOWED_STATUS
      ? parseAllowedStatus(env.TEXTS_ALLOWED_STATUS)
      : ['approved'];
    if (allowed.length !== 1 || allowed[0] !== 'approved') {
      throw new TextsStoreError(['生产环境 TEXTS_ALLOWED_STATUS 只能是 approved']);
    }
    return loadReleases(dirs.releasesDir);
  }
  return loadWorkspace(dirs.workspaceDir, parseAllowedStatus(env.TEXTS_ALLOWED_STATUS));
}

/** 启动时调用：失败即打印原因并退出进程 */
export function initTextsStoreOrExit(
  env: TextsStoreEnv,
  dirs: { releasesDir: string; workspaceDir: string },
  exit: (code: number) => never = (code) => process.exit(code),
  log: (msg: string) => void = (msg) => console.error(msg),
): TextsStore {
  try {
    return loadTextsStore(env, dirs);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return exit(1);
  }
}
