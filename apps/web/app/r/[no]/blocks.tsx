/**
 * 报告块渲染（TASKS T54；UI.md §7.3）：para（依据行、古籍引文、结论框、题签、小标题）、notice、table。
 * 图一五行力量（T55）用共用 SVG 组件；图二、图三与逐年卡片（yearCard）在 T56 实现，这里先给占位组件。
 * 所有文字来自报告 JSON，前端不增删内容。
 */
import type { Block, ParaBlock, TableBlock } from '@zhiming/core/report';
import { PowerChart, type PowerRow } from '../../power-chart';

/** 用小标题样式显示的槽位（第二章各角色、第七章各领域） */
const HEADED = /^CH2-ROLE-|^CH7-/;

function Para({ b }: { b: ParaBlock }) {
  const cls =
    b.slot === 'CH2-SUMMARY'
      ? 'rp-summary'
      : b.slot === 'CH3-PERSONA-LINE'
        ? 'rp-persona'
        : HEADED.test(b.slot)
          ? 'rp-p rp-role'
          : 'rp-p';
  return (
    <>
      <p className={cls} data-slot={b.slot}>
        {b.text}
      </p>
      {b.quote && (
        <blockquote className="rp-quote">
          {b.quote.text}
          <cite>——{b.quote.source}</cite>
        </blockquote>
      )}
      {b.basis && <p className="rp-basis">{b.basis}</p>}
    </>
  );
}

function Table({ b }: { b: TableBlock }) {
  return (
    <div className={`rp-tablewrap rp-table-${b.kind}`}>
      <table className="rp-table" data-kind={b.kind}>
        <thead>
          <tr>
            {b.columns.map((c, i) => (
              <th key={i} className={b.kind === 'chart' && i === 3 ? 'day' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j} className={b.kind === 'chart' && j === 3 ? 'day' : undefined}>
                    {b.kind === 'chart' && c.includes('、')
                      ? c.split('、').map((x) => (
                          <span key={x} className="rp-line">
                            {x}
                          </span>
                        ))
                      : c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case 'para':
      return <Para b={b} />;
    case 'notice':
      return (
        <p className="rp-notice" data-kind={b.kind}>
          {b.text}
        </p>
      );
    case 'table':
      return <Table b={b} />;
    case 'chart':
      if (b.kind === 'power')
        return (
          <figure className="rp-fig" data-testid="power-chart">
            <figcaption className="rp-figttl">图一　五行力量</figcaption>
            <PowerChart rows={b.data as unknown as PowerRow[]} title="图一 五行力量" />
            {b.caption && <p className="rp-notice">{b.caption}</p>}
          </figure>
        );
      // T56：图二 大运时间轴、图三 流年趋势
      return (
        <div className="rp-chart-ph" data-chart={b.kind}>
          {b.kind === 'dayun' ? '图二 大运时间轴' : '图三 流年趋势'}
        </div>
      );
    default:
      // yearCard：T56 实现完整卡片
      return (
        <div className="rp-card-ph" data-testid="year-card">
          {b.year} {b.ganzhi} · {b.tier}
        </div>
      );
  }
}
