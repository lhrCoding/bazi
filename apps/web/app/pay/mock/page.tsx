/**
 * 模拟支付页 /pay/mock?o=<订单号>（TASKS T47；仅 PAYMENT_MODE=mock，开发 / 测试用，生产不可用）。
 * 只带订单号，不含出生信息。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { appContext } from '../../../server/app-context';
import { ORDER_NO_RE } from '../../../server/orders';
import { MockPayButtons } from './mock-pay-buttons';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '模拟支付', robots: { index: false, follow: false } };

export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ o?: string }>;
}) {
  const { o } = await searchParams;
  if (!appContext().mock || typeof o !== 'string' || !ORDER_NO_RE.test(o)) notFound();
  return (
    <div className="wrap wrap-legal">
      <section className="legal-sec">
        <h1>模拟支付（开发用）</h1>
        <p>
          订单号：<code data-testid="mock-order">{o}</code>
        </p>
        <p>金额：¥9.9</p>
        <MockPayButtons orderNo={o} />
      </section>
    </div>
  );
}
