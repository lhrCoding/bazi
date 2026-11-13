/**
 * 隐私说明 / 免责声明页共用版式（TASKS T46；原型 design/legal.html，限宽 640 px）。
 */
import Link from 'next/link';
import { DISCLAIMER_ITEMS, GEO_ATTRIBUTION, PRIVACY_STORED_FIELDS } from './legal-content';

export function PrivacySection() {
  return (
    <section id="privacy" className="legal-sec">
      <h1>隐私说明</h1>
      <p className="lead">一句话：我们不保存你的出生日期和报告；服务器里只有订单记录。</p>
      <h2>我们收集什么</h2>
      <p>出生日期与时间（可以不填时辰）、性别、出生地（可选）。不需要姓名、手机号，不需要登录。</p>
      <h2>用来做什么</h2>
      <p>只用于即时计算你的命盘和报告。计算完成后不保存。</p>
      <h2>服务器保存哪些字段</h2>
      <p>只有付款时产生的订单记录：</p>
      <table className="fields" data-testid="stored-fields">
        <thead>
          <tr>
            <th>字段</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {PRIVACY_STORED_FIELDS.map((f) => (
            <tr key={f.label}>
              <td>{f.label}</td>
              <td>{f.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        未支付或已关闭的订单 7
        天后删除；已支付的订单长期保留（你的报告链接要靠它核对，也是财务记录）。
      </p>
      <h2>报告链接的风险，请务必知道</h2>
      <p>
        为了不在服务器保存你的出生信息，报告链接里带着你的出生信息。
        <b>链接中的出生信息只是编码、没有加密</b>，任何拿到链接的人都能看出你的出生日期。所以：
      </p>
      <ul>
        <li>请不要把链接发到公开场合（朋友圈、群聊、论坛）；保存的长图里同样含有出生信息；</li>
        <li>
          <b>链接丢失后我们无法找回</b>，请自行收藏。
        </li>
      </ul>
      <h2>交给谁</h2>
      <p>
        支付时，微信支付或支付宝只会收到订单号和金额，不会收到你的出生信息。网站不使用任何第三方统计、广告或客服插件。服务器位于中国境内。
      </p>
    </section>
  );
}

export function DisclaimerSection() {
  return (
    <section id="disclaimer" className="legal-sec">
      <h1>免责声明</h1>
      <p>
        本站内容基于传统命理文化，由代码按公开规则计算，文字来自人工审核的素材库，仅供传统文化参考与娱乐。
      </p>
      <ul>
        {DISCLAIMER_ITEMS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

export function ContactSection() {
  return (
    <section id="contact" className="legal-sec">
      <h2>联系与退款</h2>
      <p>
        已付款但报告打不开、想申请退款、或发现内容问题，请通过页面公布的联系方式联系我们（上线前公布）。
      </p>
      <p>请附上支付账单中的商户订单号。退款为人工处理；退款后原报告链接将失效。</p>
    </section>
  );
}

export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap wrap-legal">
      <div className="top">
        <Link href="/" className="l">
          <span className="seal">知命</span>
          <span className="name">知命</span>
        </Link>
        <nav className="legal-nav">
          <Link href="/privacy">隐私说明</Link>
          <Link href="/disclaimer">免责声明</Link>
        </nav>
      </div>
      {children}
      <ContactSection />
      <p className="attrib" data-testid="geo-attribution">
        {GEO_ATTRIBUTION}
      </p>
    </div>
  );
}
