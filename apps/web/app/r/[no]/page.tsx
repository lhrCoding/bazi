/**
 * 付费报告页 /r/<订单号>#<载荷>（占位：TASKS T53 实现报告 API 与渲染）。
 * 服务器只收到 /r/<订单号>；载荷在片段里。
 */
import type { Metadata } from 'next';
import { LegalFooter } from '../../legal-footer';

export const metadata: Metadata = {
  title: '命书 · 一元知命',
  robots: { index: false, follow: false },
};

export default function ReportPage() {
  return (
    <div className="wrap wrap-legal">
      <section className="legal-sec" data-testid="report-placeholder">
        <h1>你的命理报告</h1>
        <p>报告页正在建设中（T53）。</p>
      </section>
      <LegalFooter />
    </div>
  );
}
