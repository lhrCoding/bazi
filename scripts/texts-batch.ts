/**
 * npm run texts:batch -- sample|approve|reject <批次号> [--fail id1,id2] [--date YYYY-MM-DD]
 * 素材批次抽检（rules/texts/README.md §9.1）。实现见 scripts/lib/texts-batch.ts。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBatch } from './lib/texts-batch';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const [cmd, batch] = args;
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!cmd || !batch) {
  console.error(
    '用法：npm run texts:batch -- sample|approve|reject <批次号> [--fail id1,id2] [--date YYYY-MM-DD]',
  );
  process.exit(2);
}
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
try {
  const out = runBatch(cmd, batch, {
    textsDir: join(ROOT, 'rules/texts'),
    reportsDir: join(ROOT, 'reports'),
    sectionsMd: readFileSync(join(ROOT, 'rules/report-sections.md'), 'utf8'),
    date: opt('date') ?? today,
    fail: opt('fail')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  for (const l of out) console.log(l);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
