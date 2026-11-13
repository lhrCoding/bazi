/**
 * POST /api/pay/mock {orderNo, drop?} —— 模拟支付页的「模拟支付成功」（仅 PAYMENT_MODE=mock）。
 * 渠道侧记为已付，并像真实渠道一样把签名回调投递给 /api/pay/notify/mock；drop = true 模拟回调丢失（用于测查单兜底）。
 */
import { appContext, ordersDeps } from '../../../../server/app-context';
import { handleNotify } from '../../../../server/orders-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const mock = appContext().mock;
  if (!mock) return new Response(null, { status: 404 });
  const body = (await req.json().catch(() => null)) as { orderNo?: unknown; drop?: unknown } | null;
  if (typeof body?.orderNo !== 'string') return Response.json({ ok: false }, { status: 400 });
  const r = mock.pay(body.orderNo);
  if (!r) return Response.json({ ok: false }, { status: 404 });
  if (body.drop !== true) await handleNotify('mock', r.notify, ordersDeps());
  return Response.json({ ok: true });
}
