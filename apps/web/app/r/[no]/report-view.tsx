'use client';
/**
 * 付费报告页「命书」（TASKS T54；UI.md §7.1–§7.3、§7.5、§7.6；ARCHITECTURE §6.3）。
 * 静态外壳：浏览器读 /r/<订单号> 与 # 片段 → POST /api/report → 渲染。不依赖 Cookie / localStorage，
 * 关闭浏览器、换浏览器、换设备用同一链接都能打开。页面内没有任何付费按钮。R-CHECK 告警对用户不可见。
 */
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { decodePayload, type PayloadV1 } from '@zhiming/core/birth';
import type { Chapter, ReportEvent } from '@zhiming/core/report';
import { echoText } from '../../birth-form-logic';
import { LegalFooter } from '../../legal-footer';
import { BlockView } from './blocks';
import type { DayunRow } from './timeline';

interface ReportData {
  meta: {
    textsVersion: string;
    rulesVersion: string;
    engineVersion: string;
    tstStatus: string;
    refDate: number;
  };
  chapters: Chapter[];
  events?: ReportEvent[];
}
type State =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'ok'; data: ReportData; payload: PayloadV1 };

const CH_NO = ['〇', '一', '二', '三', '四', '五', '六', '七', '八'] as const;
/** 目录右侧标注本章含有的图表 */
const CH_ART: Partial<Record<number, string>> = { 0: '表', 1: '图一', 5: '图二', 6: '图三 · 卡片' };
const GAN_EL: Readonly<Record<string, string>> = {
  甲: '木',
  乙: '木',
  丙: '火',
  丁: '火',
  戊: '土',
  己: '土',
  庚: '金',
  辛: '金',
  壬: '水',
  癸: '水',
};
const COPY_OK =
  '已复制报告链接。建议发到微信「文件传输助手」或存进备忘录。链接含出生信息，请勿公开分享。';

async function seenKey(orderNo: string): Promise<string> {
  // 「已看过」标记只存订单号的哈希，不含出生信息（UI.md §7.2）
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(orderNo));
  return `seen:${[...new Uint8Array(d)]
    .slice(0, 8)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

function fmtDate(ms: number): string {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}年${g('month')}月${g('day')}日`;
}

function SaveNotice({ first, onCopy }: { first: boolean; onCopy: () => void }) {
  const longImage = (
    <button type="button" className="btn rp-btn-line" disabled title="T58 实现">
      保存为长图
    </button>
  );
  if (first)
    return (
      <section className="rp-save first" data-testid="save-notice" aria-label="保存提示">
        <h2>请先保存这份报告</h2>
        <ol>
          <li>我们不保存你的出生信息和报告，链接丢失将无法找回。</li>
          <li>微信里点右上角「···」→「收藏」，或复制链接存到备忘录。</li>
          <li>也可以保存为长图，放进相册。</li>
        </ol>
        <div className="rp-save-btns">
          <button type="button" className="btn btn-primary" onClick={onCopy}>
            复制报告链接
          </button>
          {longImage}
        </div>
        <p className="rp-share" data-testid="share-warning">
          链接里含有你的出生信息（仅编码、未加密），请勿公开分享。
        </p>
      </section>
    );
  return (
    <section className="rp-save" data-testid="save-notice" aria-label="保存提示">
      <p>链接丢失无法找回，请收藏本页或保存为长图</p>
      <div className="rp-save-btns">
        <button type="button" className="btn btn-primary" onClick={onCopy}>
          复制链接
        </button>
        {longImage}
      </div>
      <p className="rp-share" data-testid="share-warning">
        链接含出生信息（仅编码、未加密），请勿公开分享。
      </p>
    </section>
  );
}

function Cover({ data, payload }: { data: ReportData; payload: PayloadV1 }) {
  const table = data.chapters[0]?.blocks.find((b) => b.type === 'table' && b.kind === 'chart');
  const gz = table && table.type === 'table' ? (table.rows[0]?.slice(1) ?? []) : [];
  const dayGan = gz[2]?.[0] ?? '';
  const liunian = data.chapters[6]?.blocks.find((b) => b.type === 'chart' && b.kind === 'liunian');
  const first =
    liunian && liunian.type === 'chart'
      ? (liunian.data[0] as { year?: number; ganzhi?: string } | undefined)
      : undefined;
  const tst =
    payload.t === null
      ? '时辰未知，按三柱分析'
      : data.meta.tstStatus === '已校正'
        ? '已按出生地校正真太阳时'
        : '北京时间，未校正真太阳时';
  return (
    <header className="rp-cover" data-testid="cover">
      <div className="rp-ttl">命书</div>
      <div className="rp-sub">
        {dayGan}
        {GAN_EL[dayGan] ?? ''}日主 · {payload.g === 'm' ? '男命' : '女命'}
      </div>
      <div className="rp-gz">
        {['年', '月', '日', '时'].map((l, i) => (
          <div key={l} className={i === 2 ? 'day' : undefined}>
            <span className="v">{gz[i] && gz[i] !== '未知' ? gz[i] : '未知'}</span>
            <small>{l}柱</small>
          </div>
        ))}
      </div>
      <div className="rp-meta">
        {echoText(payload, null).split(' · ').slice(0, 1)} · {tst}
        <br />依 {fmtDate(data.meta.refDate)} 排定
        {first?.year ? ` · 流年自 ${first.year} ${first.ganzhi ?? ''}年起` : ''}
      </div>
      <span className="seal rp-seal">知命</span>
    </header>
  );
}

export function ReportView() {
  const params = useParams<{ no: string }>();
  const orderNo = params.no;
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const [first, setFirst] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const encoded = window.location.hash.slice(1);
    const d = decodePayload(encoded);
    void (async () => {
      if (!d.ok) {
        if (!cancelled)
          setSt({
            kind: 'error',
            title: '链接不完整',
            message: '链接中没有出生信息或已损坏。请使用付款后收到的完整链接。',
          });
        return;
      }
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderNo, payload: encoded }),
      }).catch(() => null);
      if (cancelled) return;
      if (!res) {
        setSt({ kind: 'error', title: '网络异常', message: '请检查网络后刷新页面。' });
        return;
      }
      const body = (await res.json().catch(() => null)) as
        ReportData | { error?: { message: string } } | null;
      if (cancelled) return;
      if (!res.ok || !body || !('chapters' in body)) {
        const msg =
          (body as { error?: { message: string } } | null)?.error?.message ?? '请稍后刷新重试。';
        setSt({
          kind: 'error',
          title: res.status === 403 ? '链接无效或订单未支付' : '暂时无法打开报告',
          message: msg,
        });
        return;
      }
      try {
        const k = await seenKey(orderNo);
        setFirst(localStorage.getItem(k) === null);
        localStorage.setItem(k, '1');
      } catch {
        setFirst(true);
      }
      setSt({ kind: 'ok', data: body, payload: d.payload });
    })();
    return () => {
      cancelled = true;
    };
  }, [orderNo]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast(COPY_OK);
    } catch {
      setToast('复制失败，请手动复制浏览器地址栏里的完整链接。');
    }
  }

  if (st.kind !== 'ok')
    return (
      <div className="wrap wrap-legal">
        {st.kind === 'loading' ? (
          <div className="state" aria-busy="true">
            <span className="state-icon good">候</span>
            <h1>正在生成你的报告</h1>
          </div>
        ) : (
          <div className="state" role="alert" data-testid="report-error">
            <span className="state-icon">无</span>
            <h1>{st.title}</h1>
            <div className="state-body">
              <p>{st.message}</p>
            </div>
          </div>
        )}
        <LegalFooter />
      </div>
    );

  const { data, payload } = st;
  const dayunBlock = data.chapters[5]?.blocks.find((b) => b.type === 'chart' && b.kind === 'dayun');
  const dayunRows = (dayunBlock && dayunBlock.type === 'chart'
    ? dayunBlock.data
    : []) as unknown as DayunRow[];
  return (
    <div className="rp-wrap">
      <SaveNotice first={first} onCopy={() => void copyLink()} />
      <Cover data={data} payload={payload} />
      <nav className="rp-toc" id="toc" aria-label="目录">
        <h3>目 录</h3>
        <ol>
          {data.chapters.map((c) => (
            <li key={c.id}>
              <a href={`#ch${c.id}`}>
                <b>第{CH_NO[c.id]}章</b>
                <span>{c.title}</span>
                <i>{CH_ART[c.id] ?? ''}</i>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {data.chapters.map((c) => (
        <section key={c.id} id={`ch${c.id}`} className="rp-ch" data-testid={`chapter-${c.id}`}>
          <div className="rp-chno">第{CH_NO[c.id]}章</div>
          <h2 className="rp-chttl">{c.title}</h2>
          {c.blocks.map((b, i) => (
            <BlockView key={i} b={b} dayun={dayunRows} />
          ))}
        </section>
      ))}
      <div className="rp-end">
        <span className="seal rp-seal-end">知命</span>
        <p>传统文化参考 · 不构成专业建议</p>
      </div>
      <LegalFooter />
      {toast && (
        <div className="rp-toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      <div className="rp-bar" data-testid="action-bar">
        <a href="#toc">目录</a>
        <button type="button" onClick={() => void copyLink()}>
          复制链接
        </button>
        <button type="button" className="btn btn-primary" disabled title="T58 实现">
          保存长图
        </button>
      </div>
    </div>
  );
}
