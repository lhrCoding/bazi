/**
 * 图二 大运时间轴、图三 流年趋势线（TASKS T56；UI.md §8）。手写 SVG；数据全部来自报告 JSON。
 * 档位阈值与 R-YUN-SCORE / R-LN-SCORE 相同（±0.4、±1.2，大运与流年一致）。
 * 不只靠颜色区分：大运列表、图例、流年色带都写出档位文字。
 */
export const TIERS = ['顺势期', '向好', '平稳', '宜稳守', '宜保守、打基础'] as const;
export const TIER_COLOR: Readonly<Record<string, string>> = {
  顺势期: '#A93226',
  向好: '#C9806F',
  平稳: '#B8AD9E',
  宜稳守: '#7F93A3',
  '宜保守、打基础': '#4F6578',
};

export interface DayunRow {
  ganzhi: string;
  start_year: number;
  end_year: number;
  start_age: number | null;
  ten_god?: string;
  score: number;
  tier: string;
  phase: 'past' | 'current' | 'next' | 'far';
}
export interface LiunianRow {
  year: number;
  ganzhi: string;
  score: number;
  tier: string;
}

const fmtScore = (s: number) => Math.max(-2, Math.min(2, s));

export function DayunChart({ rows }: { rows: readonly DayunRow[] }) {
  const W = 340;
  const colW = W / Math.max(rows.length, 1);
  const TOP = 34;
  const HALF = 80;
  const base = TOP + HALF;
  const H = base + HALF + 34;
  const y = (s: number) => base - fmtScore(s) * 40;
  return (
    <figure className="rp-fig" data-testid="dayun-chart">
      <figcaption className="rp-figttl">图二　大运时间轴</figcaption>
      <svg
        className="tl-chart"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`图二 大运时间轴：${rows.map((r) => `${r.ganzhi}（${r.start_year}起，${r.tier}）`).join('，')}`}
      >
        {rows.map((r, i) =>
          r.phase === 'current' ? (
            <rect
              key="cur"
              x={i * colW + 1}
              y={2}
              width={colW - 2}
              height={H - 4}
              className="tl-cur"
            />
          ) : null,
        )}
        {[1.2, 0.4, -0.4, -1.2].map((t) => (
          <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className="tl-dash" />
        ))}
        <line x1={0} x2={W} y1={base} y2={base} className="tl-base" />
        {rows.map((r, i) => {
          const cx = i * colW + colW / 2;
          const top = Math.min(y(r.score), base);
          const h = Math.max(Math.abs(y(r.score) - base), 1.5);
          return (
            <g
              key={r.ganzhi + r.start_year}
              opacity={r.phase === 'past' ? 0.45 : 1}
              data-ganzhi={r.ganzhi}
              data-phase={r.phase}
              data-tier={r.tier}
            >
              {r.phase === 'current' && (
                <text x={cx} y={12} textAnchor="middle" className="tl-curtxt">
                  当前
                </text>
              )}
              <text x={cx} y={28} textAnchor="middle" className="tl-gz">
                {r.ganzhi}
              </text>
              <rect
                x={cx - 7}
                y={top}
                width={14}
                height={h}
                fill={TIER_COLOR[r.tier]}
                className={r.phase === 'current' ? 'tl-bar cur' : 'tl-bar'}
              />
              <text x={cx} y={H - 18} textAnchor="middle" className="tl-age">
                {r.start_age === null ? '' : `${r.start_age}岁`}
              </text>
              <text x={cx} y={H - 4} textAnchor="middle" className="tl-year">
                {r.start_year}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend />
      <table className="rp-table tl-list" data-testid="dayun-list">
        <thead>
          <tr>
            <th>年龄与年份</th>
            <th>干支</th>
            <th>天干十神</th>
            <th>档位</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ganzhi + r.start_year} className={r.phase === 'current' ? 'cur' : undefined}>
              <td>
                {r.start_age === null ? '' : `${r.start_age}岁 · `}
                {r.start_year}–{r.end_year}
              </td>
              <td className="gz">{r.ganzhi}</td>
              <td>{r.ten_god ?? ''}</td>
              <td>
                <TierChip tier={r.tier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function TierChip({ tier }: { tier: string }) {
  return (
    <span className="tier-chip" style={{ background: TIER_COLOR[tier] }}>
      {tier}
    </span>
  );
}

function Legend() {
  return (
    <div className="tl-legend" aria-hidden="true">
      {TIERS.map((t) => (
        <span key={t}>
          <i style={{ background: TIER_COLOR[t] }} />
          {t}
        </span>
      ))}
    </div>
  );
}

/** 流年分数 → 纵坐标：五条档位色带各占一格，带内按分数线性分布（两端截到 ±2） */
function bandY(score: number, band: number, top: number): number {
  const pts: [number, number][] = [
    [2, 0],
    [1.2, 1],
    [0.4, 2],
    [-0.4, 3],
    [-1.2, 4],
    [-2, 5],
  ];
  const s = fmtScore(score);
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, b0] = pts[i] as [number, number];
    const [s1, b1] = pts[i + 1] as [number, number];
    if (s <= s0 && s >= s1) return top + (b0 + ((s0 - s) / (s0 - s1)) * (b1 - b0)) * band;
  }
  return top + 5 * band;
}

export function LiunianChart({
  rows,
  dayun,
}: {
  rows: readonly LiunianRow[];
  dayun: readonly DayunRow[];
}) {
  const W = 340;
  const LEFT = 94;
  const TOP = 8;
  const BAND = 26;
  const H = TOP + BAND * 5 + 40;
  const step = (W - LEFT - 16) / Math.max(rows.length - 1, 1);
  const pts = rows.map((r, i) => ({ r, x: LEFT + 8 + i * step, y: bandY(r.score, BAND, TOP) }));
  const switches = rows
    .map((r, i) => ({ r, i, d: dayun.find((d) => d.start_year === r.year) }))
    .filter((x) => x.i > 0 && x.d);
  return (
    <figure className="rp-fig" data-testid="liunian-chart">
      <figcaption className="rp-figttl">图三　未来 5 年流年趋势</figcaption>
      <svg
        className="tl-chart"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`图三 流年趋势：${rows.map((r) => `${r.year}${r.ganzhi}年 ${r.tier}`).join('，')}`}
      >
        {TIERS.map((t, i) => (
          <g key={t}>
            <rect
              x={LEFT}
              y={TOP + i * BAND}
              width={W - LEFT}
              height={BAND}
              fill={TIER_COLOR[t]}
              opacity={0.13}
            />
            <text
              x={LEFT - 6}
              y={TOP + i * BAND + BAND / 2 + 4}
              textAnchor="end"
              className="tl-band"
            >
              {t}
            </text>
          </g>
        ))}
        {switches.map(({ r, i, d }) => {
          const x = ((pts[i - 1]?.x ?? 0) + (pts[i]?.x ?? 0)) / 2;
          return (
            <g key={r.year} data-testid="dayun-switch">
              <line x1={x} x2={x} y1={TOP} y2={TOP + BAND * 5} className="tl-switch" />
              <text x={x + 3} y={TOP + 10} className="tl-switchtxt">
                {r.year} 起 {d?.ganzhi}运
              </text>
            </g>
          );
        })}
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="tl-line" />
        {pts.map(({ r, x, y }, i) => (
          <g key={r.year} data-year={r.year} data-ganzhi={r.ganzhi} data-tier={r.tier}>
            <circle cx={x} cy={y} r={i === 0 ? 5 : 4} className={i === 0 ? 'tl-pt now' : 'tl-pt'} />
            {i === 0 && (
              <text x={x} y={y - 9} textAnchor="middle" className="tl-now">
                今年
              </text>
            )}
            <text x={x} y={TOP + BAND * 5 + 16} textAnchor="middle" className="tl-year">
              {r.year}
            </text>
            <text x={x} y={TOP + BAND * 5 + 32} textAnchor="middle" className="tl-gzs">
              {r.ganzhi}
            </text>
          </g>
        ))}
      </svg>
      <p className="rp-notice">每年以立春为界。</p>
    </figure>
  );
}
