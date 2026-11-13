/**
 * 付费报告页 /r/<订单号>#<载荷>（TASKS T54）。服务器只收到 /r/<订单号>，返回静态外壳；载荷在片段里，由浏览器读取。
 */
import type { Metadata } from 'next';
import { ReportView } from './report-view';

export const metadata: Metadata = {
  title: '命书 · 一元知命',
  robots: { index: false, follow: false },
  // 报告链接含出生信息：不向外站发送来源地址
  referrer: 'no-referrer',
};

export default function ReportPage() {
  return <ReportView />;
}
