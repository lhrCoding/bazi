/**
 * 逐年卡片（TASKS T56；UI.md §7.4）。数据全部来自报告 JSON 的 yearCard 块。
 * 头部：年份、干支、十神、档位色块 + 五档点阵（不显示原始分数，分数只在依据行）；立春时刻与所在大运；
 * 年度主题、四领域 2×2、适合做、留意、冲合（有才显示）、依据行。卡片不跨长图分割点（break-inside: avoid）。
 */
import type { ParaBlock, YearCard } from '@zhiming/core/report';
import { TierChip, TIERS } from './timeline';

const DOMAINS = [
  ['career', '事业'],
  ['wealth', '财运'],
  ['love', '感情'],
  ['health', '健康'],
] as const;

const text = (ps: readonly ParaBlock[]) => ps.map((p) => p.text).join('');

function lichunText(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日 ${m[4]} 立春起` : '';
}

export function YearCardView({ c }: { c: YearCard }) {
  // 五档点阵：宜保守、打基础 = 1 … 顺势期 = 5
  const level = TIERS.length - TIERS.indexOf(c.tier as (typeof TIERS)[number]);
  return (
    <article className="yc" data-testid="year-card" data-year={c.year} data-ganzhi={c.ganzhi}>
      <header className="yc-head">
        <div className="yc-ttl">
          <b>{c.year}</b> {c.ganzhi}年
        </div>
        <div className="yc-tags">
          <span className="yc-god">{c.ten_god}</span>
          <TierChip tier={c.tier} />
        </div>
      </header>
      <div className="yc-dots" aria-label={`档位第 ${level} 档（共 5 档）`}>
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className={i < level ? 'on' : undefined} />
        ))}
      </div>
      <p className="yc-meta">
        {lichunText(c.lichun)}
        {c.dayun ? ` · 所在大运 ${c.dayun}` : ''}
        {c.dayun_mark ? `（${c.dayun_mark}）` : ''}
      </p>
      {c.head.length > 0 && <p className="yc-theme">{text(c.head)}</p>}
      <div className="yc-grid">
        {DOMAINS.map(([k, label]) =>
          c.domains[k].length > 0 ? (
            <div key={k} className="yc-dom">
              <b>{label}</b>
              <p>{text(c.domains[k])}</p>
            </div>
          ) : null,
        )}
      </div>
      {c.do.length > 0 && (
        <p className="yc-do">
          <b>适合做</b>
          {text(c.do)}
        </p>
      )}
      {c.watch.length > 0 && (
        <p className="yc-watch">
          <b>留意</b>
          {text(c.watch)}
        </p>
      )}
      {c.rel.length > 0 && <p className="yc-rel">{text(c.rel)}</p>}
      <p className="rp-basis">{c.basis}</p>
    </article>
  );
}
