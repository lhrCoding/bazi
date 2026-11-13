'use client';
/**
 * 支付确认面板（TASKS T48；UI.md §6.1 PayConfirmSheet，原型 design/pay.html 画板 A / B / C / I）。
 * 手机（微信内 / 其他浏览器）：底部面板；电脑：居中面板，左侧内容与价格，右侧支付方式。
 * 下单：POST /api/orders {payload, channel} → localStorage['pending:'+订单号] = 载荷（只在本机）→ 按调起参数跳转。
 * 无时辰时内容清单换成三柱缺失说明（PRD P0-5：付费前一定能看到）。
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Channel } from '../../server/orders/schema';
import { payOptions, pendingKey, type PayAction, type PayEnv } from '../pay-env';

const ITEMS = [
  '命盘总览与吉神',
  '日主旺衰详解',
  '喜用神详解',
  '性格与天赋',
  '行业 / 颜色 / 方位 / 数字',
  '十年大运时间轴',
  '未来 5 年逐年卡片',
  '事业 / 财运 / 感情 / 健康',
] as const;
const SAVE_NOTE = '我们不保存出生信息。付款后请收藏报告链接或保存长图，链接丢失无法找回。';

type PayParams =
  | { kind: 'redirect'; url: string }
  | { kind: 'qrcode'; codeUrl: string }
  | { kind: 'jsapi'; params: Record<string, string> };

export function PaySheet(props: {
  env: PayEnv;
  channels: readonly Channel[];
  payload: string;
  nohourNotice: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { primary, secondary } = payOptions(props.env, props.channels);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const [tab, setTab] = useState<PayAction | null>(primary);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  async function run(a: PayAction) {
    setMsg(null);
    if (a.kind === 'copy-to-wechat') {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setMsg('链接已复制。打开微信，粘贴到任意聊天里点开，即可用微信支付。');
      } catch {
        setMsg('复制失败，请手动复制浏览器地址栏里的链接，到微信中打开。');
      }
      return;
    }
    if (a.kind === 'open-in-browser') {
      setGuide(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: props.payload, channel: a.channel }),
      });
      const body = (await res.json().catch(() => null)) as
        { orderNo: string; pay: PayParams } | { error?: { message: string } } | null;
      if (!res.ok || !body || !('orderNo' in body)) {
        setMsg(
          (body as { error?: { message: string } } | null)?.error?.message ??
            '下单失败，请稍后再试。',
        );
        setBusy(false);
        return;
      }
      try {
        localStorage.setItem(pendingKey(body.orderNo), props.payload);
      } catch {
        // 无痕模式等无法写入：支付返回页会提示回到原页面
      }
      const pay = body.pay;
      if (pay.kind === 'redirect') {
        if (pay.url.startsWith('/')) router.push(pay.url);
        else window.location.assign(pay.url);
      } else if (pay.kind === 'qrcode') {
        setQr(pay.codeUrl); // T50 渲染二维码图片
        setBusy(false);
      } else {
        setMsg('微信支付将在后续版本接入。');
        setBusy(false);
      }
    } catch {
      setMsg('网络异常，请稍后再试。');
      setBusy(false);
    }
  }

  const content = props.nohourNotice ? (
    <div className="nohour-note" data-testid="sheet-nohour">
      {props.nohourNotice}价格不变。
    </div>
  ) : (
    <ul className="sheet-items">
      {ITEMS.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
  const price = (
    <div className="price">
      <b>¥9.9</b>
      <span>一次付清，没有会员、续费和追加</span>
    </div>
  );
  const btn = (a: PayAction, main: boolean) => (
    <button
      type="button"
      className={`btn ${a.kind === 'pay' ? `btn-${a.tone}` : main ? 'btn-primary' : 'btn-line'}`}
      disabled={busy && a.kind === 'pay'}
      onClick={() => void run(a)}
      data-testid={main ? 'pay-primary' : 'pay-secondary'}
    >
      {busy && a.kind === 'pay' ? '正在下单…' : a.label}
    </button>
  );
  const unavailable = <p className="err">支付暂未开通，请稍后再来。</p>;

  return (
    <>
      <div className="mask" onClick={props.onClose} />
      {props.env === 'desktop' ? (
        <div
          className="paydesk"
          role="dialog"
          aria-modal="true"
          aria-label="完整命理报告"
          data-testid="pay-desktop"
        >
          <div className="paydesk-l">
            <h3>完整命理报告</h3>
            {price}
            {content}
            <p className="sub">{SAVE_NOTE}</p>
          </div>
          <div className="paydesk-r">
            <button type="button" className="close" onClick={props.onClose}>
              关闭
            </button>
            {primary ? (
              <>
                <div className="seg" role="group" aria-label="支付方式">
                  {[primary, secondary]
                    .filter((x): x is PayAction => x !== null)
                    .map((a) => (
                      <button
                        key={a.label}
                        type="button"
                        aria-pressed={tab?.label === a.label}
                        onClick={() => {
                          setTab(a);
                          setQr(null);
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                </div>
                <div className="qrbox">
                  {qr ? (
                    <p className="sub" data-testid="qr">
                      请用微信扫码支付
                    </p>
                  ) : (
                    tab && (
                      <button
                        type="button"
                        className={`btn btn-${tab.kind === 'pay' ? tab.tone : 'primary'}`}
                        disabled={busy}
                        onClick={() => void run(tab)}
                        data-testid="pay-primary"
                      >
                        {busy
                          ? '正在下单…'
                          : tab.label === '微信扫码'
                            ? '生成微信支付二维码'
                            : '前往支付宝付款 ¥9.9'}
                      </button>
                    )
                  )}
                </div>
              </>
            ) : (
              unavailable
            )}
            {msg && <p className="err">{msg}</p>}
          </div>
        </div>
      ) : (
        <div
          className="sheet paysheet"
          role="dialog"
          aria-modal="true"
          aria-label="完整命理报告"
          data-testid="pay-sheet"
        >
          <h3>
            完整命理报告
            <button type="button" onClick={props.onClose}>
              关闭
            </button>
          </h3>
          {price}
          {content}
          {primary ? btn(primary, true) : unavailable}
          {secondary && (
            <>
              <div className="or">想用微信支付</div>
              {btn(secondary, false)}
              <p className="sub">复制后在微信里打开这个链接，再点「¥9.9 查看完整报告」。</p>
            </>
          )}
          {msg && (
            <p className="err" role="status">
              {msg}
            </p>
          )}
          <p className="sub">{SAVE_NOTE}</p>
        </div>
      )}
      {guide && (
        <div className="guide" onClick={() => setGuide(false)} data-testid="browser-guide">
          <p>
            请点右上角 <b>···</b>
            <br />
            选择「在浏览器打开」，再用支付宝支付
          </p>
        </div>
      )}
    </>
  );
}
