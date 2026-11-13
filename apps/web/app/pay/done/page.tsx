/**
 * 支付返回页 /pay/done?o=<订单号>（TASKS T48；UI.md §6.2 画板 D / E / G / H）。
 * URL 只带订单号；载荷从本机 localStorage['pending:'+订单号] 取回。轮询订单状态，paid 后跳 /r/<订单号>#<载荷>。
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DoneView } from './done-view';

export const metadata: Metadata = {
  title: '支付结果 · 一元知命',
  robots: { index: false, follow: false },
};

export default function PayDonePage() {
  return (
    <Suspense>
      <DoneView />
    </Suspense>
  );
}
