/**
 * 构建后扫描浏览器端代码，确认不含素材正文（TASKS T63：防止素材库被打包进前端而泄露）。
 *
 * 用法：先 `npm run build`，再 `npm run check:bundle`。
 * 做法：从 rules/texts/*.yaml 每个变体的无占位符正文上每隔 8 字取 12 字特征串（同时检查原文与 \uXXXX 转义形式），
 * 在 apps/web/.next/static/**\/*.js 中搜索；任一命中即失败（退出码 1）。
 * 阳性对照：前端固定文案「¥9.9 查看完整报告」必须能搜到，否则说明扫描本身失效（如构建目录不对），同样失败。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseTextsFiles } from '../packages/core/src/texts/yaml';

const ROOT = join(import.meta.dirname, '..');
const TEXTS = join(ROOT, 'rules', 'texts');
const STATIC = join(ROOT, 'apps', 'web', '.next', 'static');
const MARK_LEN = 12;
const MARK_STEP = 8;
const CONTROL = '¥9.9 查看完整报告';

const escapeU = (s: string): string =>
  [...s]
    .map((c) =>
      c.charCodeAt(0) > 0x7f ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c,
    )
    .join('');

/** 每个变体的每段无占位符正文上，每隔 MARK_STEP 字取一个 12 字窗口（连续泄露 ≥ 20 字必然命中） */
export function markersOf(variants: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of variants) {
    for (const seg of v.split(/\{[^}]*\}/).map((x) => x.trim())) {
      for (let i = 0; i + MARK_LEN <= seg.length; i += MARK_STEP)
        out.push(seg.slice(i, i + MARK_LEN));
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

function main(): void {
  if (!existsSync(STATIC)) {
    console.error(`未找到构建产物 ${STATIC}，请先运行 npm run build`);
    process.exit(1);
  }
  const files = readdirSync(TEXTS)
    .filter((f) => f.endsWith('.yaml') && f !== 'batches.yaml' && f !== 'glossary.yaml')
    .map((file) => ({ file, source: readFileSync(join(TEXTS, file), 'utf8') }));
  const entries = parseTextsFiles(files);
  const markers = [
    ...new Set(entries.flatMap((e) => markersOf(e.variants).map((m) => `${e.id}\t${m}`))),
  ];
  const bundle = walk(STATIC).map((p) => ({ p, s: readFileSync(p, 'utf8') }));
  const all = bundle.map((b) => b.s).join('\n');
  if (!all.includes(CONTROL) && !all.includes(escapeU(CONTROL))) {
    console.error(`阳性对照失败：客户端代码里找不到「${CONTROL}」，扫描目录可能不对`);
    process.exit(1);
  }
  const leaks: string[] = [];
  for (const row of markers) {
    const [id, m] = row.split('\t') as [string, string];
    const hit = bundle.find((b) => b.s.includes(m) || b.s.includes(escapeU(m)));
    if (hit) leaks.push(`${id}「${m}」→ ${hit.p.slice(ROOT.length + 1)}`);
  }
  if (leaks.length > 0) {
    console.error(
      `客户端代码含素材正文 ${leaks.length} 处：\n  ${leaks.slice(0, 20).join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `客户端代码扫描通过：${bundle.length} 个 JS 文件，${markers.length} 个素材特征串，零命中`,
  );
}

main();
