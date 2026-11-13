'use client';
/**
 * 免费结果页（TASKS T45；UI.md §5，原型 design/result.html）。
 * 从 # 片段取载荷 → POST /api/chart → 渲染 4 个模块 + 付费引导。片段不发给服务器；刷新后同一载荷结果不变。
 * 免费页只展示 4 个模块（P0-4）：结果模块内不出现性格、吉神、神煞、大运 / 流年；付费引导是固定文案。
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodePayload, encodePayload, type PayloadV1 } from '@zhiming/core/birth';
import type { FreeResult } from '@zhiming/core/report';
import { echoText } from '../birth-form-logic';
import { LegalFooter } from '../legal-footer';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; payload: PayloadV1; encoded: string; data: FreeResult };

const EL_CLASS: Readonly<Record<string, string>> = {
  木: 'e-mu',
  火: 'e-huo',
  土: 'e-tu',
  金: 'e-jin',
  水: 'e-shui',
};
const EL_VAR: Readonly<Record<string, string>> = {
  木: 'var(--color-mu)',
  火: 'var(--color-huo)',
  土: 'var(--color-tu)',
  金: 'var(--color-jin)',
  水: 'var(--color-shui)',
};
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
const ZHI_EL: Readonly<Record<string, string>> = {
  子: '水',
  丑: '土',
  寅: '木',
  卯: '木',
  辰: '土',
  巳: '火',
  午: '火',
  未: '土',
  申: '金',
  酉: '金',
  戌: '土',
  亥: '水',
};
const TIERS = ['身弱', '中和偏弱', '中和偏旺', '身旺'] as const;
const COLS = ['年柱', '月柱', '日柱', '时柱'] as const;
const RELINK = '补充出生地重新排盘';
const NO_PAYLOAD = '链接中没有出生信息，请回到首页重新输入。';
const NETWORK = '网络异常，请稍后刷新重试。';

const TOC: readonly [string, string, string][] = [
  ['〇', '命盘总览', '四柱、十神、藏干与吉神一览'],
  ['一', '你的日主与旺衰', '为什么得出这个旺衰结论，力量从哪里来'],
  ['二', '喜用神详解', '取用的思路与每个五行对你的作用'],
  ['三', '性格与天赋', '一句话画像、做事风格、天赋方向'],
  ['四', '适合的行业、颜色、方位、数字', '按喜用神给出的生活化参考'],
  ['五', '十年大运', '8 步大运时间轴，当前与下一步重点解读'],
  ['六', '未来 5 年逐年运势', '每年一张卡片：主题、四个领域、适合做、留意'],
  ['七', '事业、财运、感情、健康', '分领域的倾向与具体到年份的提示'],
  ['八', '方法说明', '本报告用了哪些规则、有哪些局限'],
];

async function fetchChart(encoded: string): Promise<{ data: FreeResult } | { message: string }> {
  try {
    const res = await fetch('/api/chart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: encoded }),
    });
    const body = (await res.json().catch(() => null)) as
      FreeResult | { error?: { message: string } } | null;
    if (res.ok && body) return { data: body as FreeResult };
    return { message: (body as { error?: { message: string } } | null)?.error?.message ?? NETWORK };
  } catch {
    return { message: NETWORK };
  }
}

function Gz({ ch, col, day }: { ch: string; col: number; day: boolean }) {
  const el = (col === 0 ? GAN_EL : ZHI_EL)[ch];
  return <div className={`gz ${el ? EL_CLASS[el] : ''}${day ? ' daycol' : ''}`}>{ch}</div>;
}

function TstLine({ text, encoded }: { text: string; encoded: string }) {
  if (text.startsWith('北京时间')) return <div className="tst">{text}</div>;
  const i = text.indexOf(RELINK);
  if (i < 0) return <div className="gray">{text}</div>;
  return (
    <div className="gray">
      {text.slice(0, i)}
      <a href={`/#${encoded}`}>{RELINK}</a>
      {text.slice(i + RELINK.length)}
    </div>
  );
}

function Pillars({
  r,
  payload,
  encoded,
  onJieqi,
}: {
  r: FreeResult;
  payload: PayloadV1;
  encoded: string;
  onJieqi: (j: 'before' | 'after' | 'unsure') => void;
}) {
  const p = r.pillars;
  const dayGan = p.ganzhi[2][0];
  const jq = p.jieqi;
  return (
    <section className="mod" data-testid="mod-pillars">
      <h2>
        <span className="no">一</span>四柱八字<small>日柱天干「{dayGan}」代表你</small>
      </h2>
      {jq && (
        <div className="jq" data-testid="jieqi">
          <p>
            <b>
              你出生当天 {jq.time} 交「{jq.name}」，年柱、月柱会因此不同。
            </b>
            若记得大致出生在这个时刻之前还是之后，请选择：
          </p>
          <div className="opts">
            {(
              [
                [
                  'before',
                  '之前',
                  jq.options ? `${jq.options.before[0]}年 ${jq.options.before[1]}月` : '',
                ],
                [
                  'after',
                  '之后',
                  jq.options ? `${jq.options.after[0]}年 ${jq.options.after[1]}月` : '',
                ],
                ['unsure', '不确定', '结论标注可信度'],
              ] as const
            ).map(([j, l, sub]) => (
              <button
                key={j}
                type="button"
                aria-pressed={payload.j === j}
                onClick={() => onJieqi(j)}
              >
                {l}
                <small>{sub}</small>
              </button>
            ))}
          </div>
          <p className="jq-note">
            {payload.j === null ? '当前按当天 12:00 计算。' : ''}
            选择后会重新排盘，结果不保存在服务器。
          </p>
        </div>
      )}
      <div className="pillars">
        <div className="rh" />
        {COLS.map((c, i) => (
          <div key={c} className={`ch${i === 2 ? ' day daycol' : ''}`}>
            {c}
          </div>
        ))}
        <div className="rh">十神</div>
        {p.stemGods.map((g, i) => (
          <div key={i} className={`tg${i === 2 ? ' daycol day' : ''}`}>
            {i === 3 && !r.hourKnown ? '' : g}
          </div>
        ))}
        <div className="rh">天干</div>
        {p.ganzhi.map((gz, i) =>
          i === 3 && !r.hourKnown ? (
            <div key={i} className="gz unknown">
              未知
            </div>
          ) : (
            <Gz key={i} ch={gz[0] ?? ''} col={0} day={i === 2} />
          ),
        )}
        <div className="rh">地支</div>
        {p.ganzhi.map((gz, i) =>
          i === 3 && !r.hourKnown ? (
            <div key={i} />
          ) : (
            <Gz key={i} ch={gz[1] ?? ''} col={1} day={i === 2} />
          ),
        )}
        <div className="rh">藏干</div>
        {p.hidden.map((hs, i) => (
          <div key={i} className={`hide${i === 2 ? ' daycol' : ''}`}>
            {hs.map((h) => (
              <span key={h}>{h.replace(/（(.+)）$/, ' $1')}</span>
            ))}
          </div>
        ))}
      </div>
      {r.hourKnown && p.tstNotice ? (
        <TstLine text={p.tstNotice} encoded={encoded} />
      ) : (
        <div className="gray">时辰未知，只排年、月、日三柱；未做真太阳时校正。</div>
      )}
    </section>
  );
}

function Power({ r }: { r: FreeResult }) {
  const { data, dayElement, supportPct } = r.power;
  return (
    <section className="mod" data-testid="mod-power">
      <h2>
        <span className="no">二</span>五行强弱<small>含日主本身</small>
      </h2>
      <div className="bars" role="list">
        {data.map(({ element, pct }) => {
          const day = element === dayElement;
          return (
            <div
              key={element}
              className={`bar${day ? ' is-day' : ''}`}
              role="listitem"
              aria-label={`${element} ${pct}%`}
            >
              <span className={`k ${EL_CLASS[element]}`}>
                {element}
                {day && <small>日主</small>}
              </span>
              <span className="t">
                {pct > 0 && <i style={{ width: `${pct}%`, background: EL_VAR[element] }} />}
              </span>
              <span className="v">{pct}%</span>
            </div>
          );
        })}
      </div>
      <p className="cap">
        帮扶你的力量（同党）占 <span className="hl">{supportPct}%</span>，消耗你的力量（异党）占{' '}
        {100 - supportPct}%。
      </p>
    </section>
  );
}

function StrengthMod({ r }: { r: FreeResult }) {
  const s = r.strength;
  const big = s.special ? `${s.special}格` : s.level;
  return (
    <section className="mod" data-testid="mod-strength">
      <h2>
        <span className="no">三</span>日主旺衰
      </h2>
      <div className="ws">
        <div className={`big${big.length > 2 ? ' long' : ''}`}>
          {big.length === 4 ? (
            <>
              {big.slice(0, 2)}
              <br />
              {big.slice(2)}
            </>
          ) : (
            big
          )}
        </div>
        <p>{s.sentence}</p>
      </div>
      {s.special ? null : (
        <div className="scale">
          <div className="track">
            {TIERS.map((t) => (
              <span key={t} className={t === s.level ? 'on' : undefined}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="de">
        <span className={s.deLing ? 'y' : 'n'}>得令</span>
        <span className={s.deDi ? 'y' : 'n'}>得地</span>
        <span className={s.deShi > 0 ? 'y' : 'n'}>
          得势{s.deShi > 0 ? ` · 天干有 ${s.deShi} 个帮手` : ''}
        </span>
      </div>
      {s.confidenceNote && <div className="gray">{s.confidenceNote}</div>}
    </section>
  );
}

function YongMod({ r }: { r: FreeResult }) {
  const y = r.yongshen;
  return (
    <section className="mod" data-testid="mod-yongshen">
      <h2>
        <span className="no">四</span>喜用神与忌神
      </h2>
      <div className="yj">
        <div className="box good">
          <div className="t">对你有利</div>
          <div className="els">
            <span className={`el ${EL_CLASS[y.yong]}`}>
              {y.yong}
              <sup>用</sup>
            </span>
            {y.xi.map((x) => (
              <span key={x} className={`el ${EL_CLASS[x]}`}>
                {x}
                <sup>喜</sup>
              </span>
            ))}
          </div>
        </div>
        <div className="box">
          <div className="t">需要节制</div>
          <div className="els">
            {y.ji.map((x) => (
              <span key={x} className={`el ${EL_CLASS[x]}`}>
                {x}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="sentence">{y.sentence}</p>
      {y.confidenceNote && <div className="gray">{y.confidenceNote}</div>}
    </section>
  );
}

function PayGuide({ r, payRef }: { r: FreeResult; payRef: React.RefObject<HTMLElement | null> }) {
  return (
    <section className="pay" ref={payRef} data-testid="pay">
      <h2>完整命理报告</h2>
      <p className="lead">
        上面告诉你「是什么」；完整报告讲清「为什么」，
        <br />
        以及接下来几年可以怎么安排。
      </p>
      <ol className="toc">
        {TOC.map(([n, t, d]) => (
          <li key={n}>
            <b>{n}</b>
            <span>
              {t}
              <small>{d}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="facts">
        <div>
          <b>约 6,000 字</b>结构化正文
        </div>
        <div>
          <b>3 张图</b>五行·大运·流年
        </div>
        <div>
          <b>每条结论</b>标注依据
        </div>
      </div>
      {r.nohourNotice && (
        <div className="nohour-note" data-testid="nohour-note">
          {r.nohourNotice}价格不变。
        </div>
      )}
      {/* 支付入口在 T47（支付确认面板）接入 */}
      <button type="button" className="btn btn-primary" data-testid="pay-btn">
        ¥9.9 查看完整报告
      </button>
      <p className="promise">一次付清 · 没有会员和续费 · 报告内没有追加付费</p>
      <p className="savefirst">
        我们不保存出生信息。付款后请收藏报告链接或保存长图，链接丢失无法找回。
      </p>
    </section>
  );
}

export function ResultView() {
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const [stick, setStick] = useState(false);
  const payRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (encoded: string) => {
    const d = decodePayload(encoded);
    if (!d.ok) {
      setSt({
        kind: 'error',
        message: encoded === '' ? NO_PAYLOAD : '链接中的出生信息不正确，请回到首页重新输入。',
      });
      return;
    }
    setSt({ kind: 'loading' });
    const r = await fetchChart(encoded);
    setSt(
      'data' in r
        ? { kind: 'ok', payload: d.payload, encoded, data: r.data }
        : { kind: 'error', message: r.message },
    );
  }, []);

  useEffect(() => {
    const run = () => void load(window.location.hash.slice(1));
    run();
    window.addEventListener('hashchange', run);
    return () => window.removeEventListener('hashchange', run);
  }, [load]);

  useEffect(() => {
    // 用户滚到过付费引导区之后，付费区不在视口内时（如回头看命盘）才显示购买条；一进页面不推销，也不和付费区按钮重复
    let seen = false;
    const onScroll = () => {
      const el = payRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const visible = r.top < window.innerHeight && r.bottom > 0;
      if (visible) seen = true;
      setStick(seen && !visible);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onJieqi = (j: 'before' | 'after' | 'unsure') => {
    if (st.kind !== 'ok') return;
    const encoded = encodePayload({ ...st.payload, j });
    window.history.replaceState(null, '', `#${encoded}`);
    void load(encoded);
  };

  const editHref = st.kind === 'ok' ? `/#${st.encoded}` : '/';
  return (
    <div className="wrap wrap-result">
      <div className="top">
        <div className="l">
          <span className="seal">知命</span>八字结果
        </div>
        <Link href="/">重新输入</Link>
      </div>
      {st.kind === 'loading' && (
        <div className="status" aria-busy="true">
          正在排盘…
        </div>
      )}
      {st.kind === 'error' && (
        <div className="status" role="alert" data-testid="error">
          <p>{st.message}</p>
          <Link className="btn btn-primary" href="/">
            回到首页
          </Link>
        </div>
      )}
      {st.kind === 'ok' && (
        <>
          <div className="echo">
            <span data-testid="echo">{echoText(st.payload, st.data.pillars.placeName)}</span>
            <a href={editHref}>修改</a>
          </div>
          <div data-testid="free-modules">
            <Pillars r={st.data} payload={st.payload} encoded={st.encoded} onJieqi={onJieqi} />
            <Power r={st.data} />
            <StrengthMod r={st.data} />
            <YongMod r={st.data} />
          </div>
          <PayGuide r={st.data} payRef={payRef} />
        </>
      )}
      <LegalFooter variant="result" />
      {st.kind === 'ok' && stick && (
        <div className="stick" data-testid="stick">
          <div className="in">
            <div>
              完整报告
              <br />
              一次付清
            </div>
            <button type="button" className="btn btn-primary">
              ¥9.9 查看完整报告
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
