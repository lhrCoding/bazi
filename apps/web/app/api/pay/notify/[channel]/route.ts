/** POST /api/pay/notify/<渠道> —— 渠道支付回调：验签 → 金额校验 → 幂等置 paid */
import { ordersDeps } from '../../../../../server/app-context';
import { handleNotify } from '../../../../../server/orders-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params;
  return handleNotify(channel, req, ordersDeps());
}
