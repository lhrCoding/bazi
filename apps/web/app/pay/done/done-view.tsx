'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pendingKey } from '../../pay-env';

/** 轮询间隔与「超时未确认」阈值（UI.md §6.2 G：约 30 秒） */
export const POLL_MS = 1500;
export const TIMEOUT_MS = 30_000;
const ORDER_NO_RE = /^[0-9A-Za-z]{22}$/;

type View = 'checking' | 'paid' | 'timeout' | 'closed' | 'refunded' | 'nopayload' | 'invalid';

const short = (no: string): string => `${no.slice(0, 6)}…${no.slice(-4)}`;

function readPending(no: string): string | null {
  try {
    return localStorage.getItem(pendingKey(no));
  } catch {
    return null;
  }
}

export function DoneView() {
  const router = useRouter();
  const no = useSearchParams().get('o') ?? '';
  const valid = ORDER_NO_RE.test(no);
  const [view, setView] = useState<View>(valid ? 'checking' : 'invalid');
  const start = useRef(0);
  const [round, setRound] = useState(0);

  const check = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/orders/${no}/status`, { cache: 'no-store' }).catch(() => null);
    if (!res) return false;
    if (res.status === 404) {
      setView('invalid');
      return true;
    }
    const s = ((await res.json().catch(() => null)) as { status?: string } | null)?.status;
    if (s === 'paid') {
      const payload = readPending(no);
      if (!payload) {
        setView('nopayload');
        return true;
      }
      setView('paid');
      try {
        localStorage.removeItem(pendingKey(no));
      } catch {
        // 忽略
      }
      router.replace(`/r/${no}#${payload}`);
      return true;
    }
    if (s === 'closed' || s === 'refunded') {
      setView(s);
      return true;
    }
    if (Date.now() - start.current >= TIMEOUT_MS) setView('timeout');
    return false;
  }, [no, router]);

  useEffect(() => {
    if (!valid) return;
    start.current = Date.now();
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      if (await check()) return;
      timer = setTimeout(() => void loop(), POLL_MS);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [valid, check, round]);

  const retry = () => {
    setView('checking');
    setRound((r) => r + 1);
  };

  const box = (
    icon: string,
    good: boolean,
    title: string,
    body: React.ReactNode,
    actions?: React.ReactNode,
  ) => (
    <div className="state" data-testid={`done-${view}`}>
      <span className={`state-icon${good ? ' good' : ''}`}>{icon}</span>
      <h1>{title}</h1>
      <div className="state-body">{body}</div>
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );

  let content: React.ReactNode;
  switch (view) {
    case 'checking':
      content = box(
        '候',
        true,
        '正在确认支付结果',
        <p>一般几秒钟。请不要关闭页面，也不要重复付款。</p>,
        <button type="button" className="linkbtn" onClick={retry}>
          已付款但一直没跳转？点这里刷新
        </button>,
      );
      break;
    case 'paid':
      content = box('成', true, '支付成功', <p>正在打开你的报告……</p>);
      break;
    case 'timeout':
      content = box(
        '候',
        false,
        '暂时没有收到支付结果',
        <>
          <p>如果你已经扣款，请不要重复支付，稍等片刻再刷新。</p>
          <p className="sub">订单号 {short(no)} · 金额 ¥9.9</p>
        </>,
        <>
          <button type="button" className="btn btn-primary" onClick={retry}>
            刷新支付状态
          </button>
          <Link href="/privacy#contact">联系我们（请附订单号）</Link>
        </>,
      );
      break;
    case 'closed':
      content = box(
        '闭',
        false,
        '订单已超时关闭',
        <p>这笔订单 30 分钟内没有完成支付，已经关闭，没有扣款。请回到结果页重新下单。</p>,
        <Link className="btn btn-primary" href="/">
          回到首页
        </Link>,
      );
      break;
    case 'refunded':
      content = box('闭', false, '订单已退款', <p>该订单已退款，报告链接已失效。</p>);
      break;
    case 'nopayload':
      content = box(
        '缺',
        false,
        '支付成功，但这个浏览器里没有出生信息',
        <>
          <p>为了不在服务器保存你的出生信息，报告链接需要在付款时的同一个浏览器里生成。</p>
          <p>请在付款时使用的那个浏览器里重新打开本页面，即可跳转到报告。</p>
          <p className="sub">订单号 {short(no)}。如仍无法打开，请联系我们并附上订单号。</p>
        </>,
      );
      break;
    default:
      content = box(
        '误',
        false,
        '链接不完整',
        <p>没有找到这笔订单，请检查链接是否完整。</p>,
        <Link className="btn btn-primary" href="/">
          回到首页
        </Link>,
      );
  }
  return <div className="wrap wrap-legal">{content}</div>;
}
