/**
 * 五行力量图（TASKS T55；UI.md §8 图一）：手写 SVG 横向条形图，报告页图一与免费结果页共用。
 *
 * 5 行固定木火土金水；每行：五行字（+ 十神组小字）、条形、百分比、角色标签（用 = 朱砂实底；喜 = 朱砂框；忌 = 灰框；闲 = 灰字）。
 * 日主所在一行加朱砂细框并标「日主」。不能只靠颜色区分：五行字与角色字始终写出。
 * 数据完全来自调用方（报告 JSON / 免费结果 JSON），组件不做任何计算。
 */
export interface PowerRow {
  element: string;
  pct: number;
  /** 十神组读者名（比劫、印星…）；免费页不传 */
  god?: string;
  /** 用 / 喜 / 忌 / 闲；免费页不传 */
  role?: '用' | '喜' | '忌' | '闲';
  day: boolean;
}

const EL_COLOR: Readonly<Record<string, string>> = {
  木: 'var(--color-mu)',
  火: 'var(--color-huo)',
  土: 'var(--color-tu)',
  金: 'var(--color-jin)',
  水: 'var(--color-shui)',
};

const W = 340;
const ROW = 34;
const LABEL_W = 70;
const TAG_W = 26;
const PCT_W = 40;

export function PowerChart({ rows, title }: { rows: readonly PowerRow[]; title: string }) {
  const hasRole = rows.some((r) => r.role !== undefined);
  const barX = LABEL_W;
  const barW = W - LABEL_W - PCT_W - (hasRole ? TAG_W + 6 : 0) - 6;
  const h = rows.length * ROW;
  return (
    <svg
      className="power-chart"
      viewBox={`0 0 ${W} ${h}`}
      width="100%"
      role="img"
      aria-label={`${title}：${rows.map((r) => `${r.element}${r.pct}%${r.role ? `（${r.role}）` : ''}${r.day ? '（日主）' : ''}`).join('，')}`}
    >
      {rows.map((r, i) => {
        const y = i * ROW;
        const cy = y + ROW / 2;
        const len = Math.max(0, Math.min(100, r.pct)) * (barW / 100);
        return (
          <g
            key={r.element}
            data-element={r.element}
            data-pct={r.pct}
            data-role={r.role ?? ''}
            data-day={r.day}
          >
            <text x={2} y={cy + 6} className="pc-el" fill={EL_COLOR[r.element]}>
              {r.element}
            </text>
            {(r.god || r.day) && (
              <text x={24} y={cy + 4} className={`pc-sub${r.day ? ' day' : ''}`}>
                {r.day ? '日主' : r.god}
              </text>
            )}
            {r.day && r.god && (
              <text x={24} y={cy + 15} className="pc-sub">
                {r.god}
              </text>
            )}
            <rect x={barX} y={cy - 7} width={barW} height={14} rx={2} className="pc-track" />
            {len > 0 && (
              <rect x={barX} y={cy - 7} width={len} height={14} rx={2} fill={EL_COLOR[r.element]} />
            )}
            {r.day && (
              <rect
                x={barX - 2}
                y={cy - 9}
                width={barW + 4}
                height={18}
                rx={3}
                className="pc-dayframe"
              />
            )}
            <text x={barX + barW + PCT_W} y={cy + 5} textAnchor="end" className="pc-pct">
              {r.pct}%
            </text>
            {r.role && (
              <g transform={`translate(${W - TAG_W}, ${cy - 9})`}>
                <rect width={TAG_W - 2} height={18} rx={2} className={`pc-tag pc-tag-${r.role}`} />
                <text
                  x={(TAG_W - 2) / 2}
                  y={13}
                  textAnchor="middle"
                  className={`pc-tagt pc-tagt-${r.role}`}
                >
                  {r.role}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
