/** GET /api/orders/<订单号>/status —— 只返回状态；必要时主动查单 */
import { ordersDeps } from '../../../../../server/app-context';
import { handleOrderStatus } from '../../../../../server/orders-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
  return handleOrderStatus(no, req, ordersDeps());
}
