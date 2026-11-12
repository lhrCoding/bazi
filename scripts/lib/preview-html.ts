/**
 * 报告 JSON → 预览 HTML（texts:preview；只供本地通读成品，不是正式报告页 T54）。
 * 配色、字体按 docs/UI.md §2；逐年卡片按 §7.4；手机宽度可读（单栏、16 px 边距、不横向滚动）。
 */
import type { Block, Chapter, ParaBlock, YearCard } from '../../packages/core/src/report/assemble';
import type { CaseReport } from './case-reports';

export const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const TIER_COLOR: Record<string, string> = {
  顺势期: '#A93226',
  向好: '#C9806F',
  平稳: '#B8AD9E',
  宜稳守: '#7F93A3',
  '宜保守、打基础': '#4F6578',
};
const WX_COLOR: Record<string, string> = {
  木: '#5F7F5B',
  火: '#B95A3C',
  土: '#9C7A4A',
  金: '#7E8686',
  水: '#3F5D78',
};
const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八'];

export const PREVIEW_CSS = `
:root{--paper:#F4EEE2;--paper2:#FBF8F2;--ink:#2A2521;--ink2:#5C534A;--ink3:#8F857A;--line:#DCD2C1;--zhu:#A93226;--zhubg:#F6E6E0;
--serif:"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","SimSun",serif;--kai:"Kaiti SC","STKaiti","KaiTi",var(--serif);
--sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:16.5px;line-height:1.95}
main{max-width:680px;margin:0 auto;padding:16px}
h1{font-size:28px;letter-spacing:6px;margin:8px 0}h2{font-size:22px;margin:40px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
h2 .no{color:var(--zhu);margin-right:8px}
p{margin:12px 0;text-align:justify}.basis{display:block;font:12.5px/1.6 var(--sans);color:var(--ink3);margin-top:4px}
.basis::before{content:"据 ";color:var(--zhu)}
.quote{font-family:var(--kai);font-size:18px;color:var(--ink2);border-left:3px solid var(--zhu);padding:4px 12px;margin:12px 0}
.notice{font:13px/1.7 var(--sans);color:var(--ink2);background:var(--paper2);border:1px solid var(--line);padding:8px 12px;margin:12px 0}
.tag{font:11px/1 var(--sans);color:var(--ink3);margin-left:6px}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font:14px/1.6 var(--sans);background:var(--paper2)}
td,th{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.bar{display:flex;align-items:center;gap:8px;font:13px var(--sans);margin:4px 0}.bar i{display:block;height:12px;border-radius:2px}
.card{background:var(--paper2);border:1px solid var(--line);padding:12px;margin:16px 0;break-inside:avoid}
.card h3{margin:0;font-size:22px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.chip{font:12px/1 var(--sans);color:#fff;padding:4px 8px;border-radius:2px;white-space:nowrap}
.sub{font:12.5px/1.6 var(--sans);color:var(--ink3)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.grid div{background:var(--paper);padding:8px;font-size:15px;line-height:1.8}
.grid b{display:block;font:12px var(--sans);color:var(--zhu)}
@media (max-width:420px){.grid{grid-template-columns:1fr}}
.do{background:var(--zhubg);padding:8px;margin:8px 0;font-size:15px}.watch{background:#EEEAE3;padding:8px;margin:8px 0;font-size:15px}
.empty{color:var(--ink3);font:13px var(--sans);border:1px dashed var(--line);padding:8px;margin:12px 0}
.meta{font:12.5px/1.7 var(--sans);color:var(--ink3)}a{color:var(--zhu)}
.fail{color:var(--zhu)}`;

function para(p: ParaBlock, debug: boolean): string {
  const tag = debug
    ? `<span class="tag">${esc(p.entry ?? p.slot)}${p.variant !== null ? `#${p.variant + 1}` : ''}</span>`
    : '';
  const basis = p.basis ? `<span class="basis">${esc(p.basis)}</span>` : '';
  const quote = p.quote
    ? `<div class="quote">${esc(p.quote.text)} ——${esc(p.quote.source)}</div>`
    : '';
  return `<p>${esc(p.text)}${tag}${basis}</p>${quote}`;
}

function card(c: YearCard, debug: boolean): string {
  const t = (ps: ParaBlock[]): string =>
    ps
      .map((p) => esc(p.text) + (debug ? `<span class="tag">${esc(p.entry ?? '')}</span>` : ''))
      .join('') || '<span class="sub">（暂无素材）</span>';
  const rel = c.rel.map((p) => `<p class="sub">${esc(p.text)}</p>`).join('');
  return `<div class="card"><h3><span>${c.year} ${esc(c.ganzhi)}年</span><span><span class="sub">${esc(c.ten_god)}</span> <span class="chip" style="background:${TIER_COLOR[c.tier] ?? '#999'}">${esc(c.tier)}</span></span></h3>
<div class="sub">${esc(c.lichun)} 立春起</div>${c.head.map((p) => para(p, debug)).join('')}
<div class="grid"><div><b>事业</b>${t(c.domains.career)}</div><div><b>财运</b>${t(c.domains.wealth)}</div><div><b>感情</b>${t(c.domains.love)}</div><div><b>健康</b>${t(c.domains.health)}</div></div>
<div class="do">适合做：${t(c.do)}</div><div class="watch">留意：${t(c.watch)}</div>${rel}</div>`;
}

function block(b: Block, debug: boolean): string {
  switch (b.type) {
    case 'para':
      return para(b, debug);
    case 'notice':
      return `<div class="notice">${esc(b.text)}</div>`;
    case 'table':
      return `<div class="table-wrap"><table><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</table></div>`;
    case 'chart':
      if (b.kind === 'power') {
        return `<div>${b.data
          .map(
            (d) =>
              `<div class="bar"><span>${esc(d.element)}</span><i style="width:${Number(d.pct) * 2.4}px;background:${WX_COLOR[String(d.element)]}"></i><span>${esc(d.pct)}%</span></div>`,
          )
          .join('')}<div class="sub">图一 五行力量</div></div>`;
      }
      if (b.kind === 'dayun') {
        return `<div class="table-wrap"><table><tr><th>大运</th><th>年份</th><th>档位</th></tr>${b.data
          .map(
            (d) =>
              `<tr${d.phase === 'current' ? ' style="background:#F6E6E0"' : ''}><td>${esc(d.ganzhi)}${d.phase === 'current' ? '（当前）' : ''}</td><td>${esc(d.start_year)}–${esc(d.end_year)}</td><td>${esc(d.tier)}</td></tr>`,
          )
          .join('')}</table><div class="sub">图二 大运时间轴</div></div>`;
      }
      return `<div>${b.data
        .map(
          (d) =>
            `<div class="bar"><span>${esc(d.year)}</span><i style="width:${Math.max(4, (Number(d.score) + 2) * 50)}px;background:${TIER_COLOR[String(d.tier)] ?? '#999'}"></i><span>${esc(d.tier)}</span></div>`,
        )
        .join('')}<div class="sub">图三 流年趋势</div></div>`;
    case 'yearCard':
      return card(b, debug);
  }
}

function chapter(c: Chapter, debug: boolean): string {
  const body = c.blocks.map((b) => block(b, debug)).join('\n');
  return `<section><h2><span class="no">第${CN_NUM[c.id]}章</span>${esc(c.title)}</h2>${body || '<div class="empty">本章素材尚未撰写（第 2 / 3 批）</div>'}</section>`;
}

export function reportHtml(r: CaseReport, debug = true): string {
  const fails = r.check.failures;
  const events = r.report.events;
  const head = `<p class="meta">案例 ${esc(r.id)} ${esc(r.title)} · ${esc(r.ctx.chart_key)} · 规则 ${esc(r.report.meta.rulesVersion)} · 素材 ${esc(r.report.meta.textsVersion)}<br>
预览口径：素材含 draft；灰色小字为条目 id 与变体序号（正式报告不显示）。
R-CHECK ${r.check.passed ? '通过' : `<span class="fail">不通过 ${fails.length} 项</span>（${esc([...new Set(fails.map((f) => f.rule))].join('、'))}）`}；
兜底 / 空槽 ${events.length} 次。<a href="index.html">返回目录</a></p>`;
  return page(
    `命书 · ${r.id}`,
    `${head}<h1>命书</h1>${r.report.chapters.map((c) => chapter(c, debug)).join('\n')}`,
  );
}

export function indexHtml(list: readonly CaseReport[]): string {
  const rows = list
    .map((r) => {
      return `<tr><td><a href="${esc(r.id)}.html">${esc(r.id)}</a></td><td>${esc(r.title)}</td><td>${esc(r.ctx.strength.level)}</td><td>用${esc(r.ctx.yongshen.yong)}</td><td>${r.check.passed ? '通过' : `${r.check.failures.length} 项`}</td><td>${r.report.events.length}</td></tr>`;
    })
    .join('');
  return page(
    '报告预览目录',
    `<h1>报告预览</h1><p class="meta">cases.json 全部案例（参考日期 2026-10-30）。素材含 draft；第 3、4、5、7、8 章素材未写，相应章节为空或为测试素材。</p>
<div class="table-wrap"><table><tr><th>案例</th><th>说明</th><th>旺衰</th><th>用神</th><th>R-CHECK</th><th>兜底 / 空槽</th></tr>${rows}</table></div>`,
  );
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PREVIEW_CSS}</style></head><body><main>${body}</main></body></html>\n`;
}
