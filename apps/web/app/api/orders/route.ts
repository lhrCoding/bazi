/** POST /api/orders —— 建单并向渠道下单（逻辑见 server/orders-api.ts） */
import { ordersDeps } from '../../../server/app-context';
import { handleCreateOrder } from '../../../server/orders-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handleCreateOrder(req, ordersDeps());
}
