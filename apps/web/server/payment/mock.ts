/**
 * mock 支付渠道（TASKS T47；开发 / 测试用，生产禁用）。
 *
 * 模拟渠道一侧的行为：createPayment 返回模拟支付页 /pay/mock?o=<订单号>；用户在该页点「模拟支付成功」后，
 * pay() 记下渠道侧已付款并按真实渠道的方式发回调（HMAC 签名的 JSON），回调也可以故意「丢失」，用来测试查单兜底。
 * 回调验签用进程内随机密钥（只有本进程签的回调才能通过）。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ChannelPaid,
  CreatePaymentInput,
  NotifyResult,
  PayParams,
  PaymentProvider,
} from './types';

export interface MockProvider extends PaymentProvider {
  /** 模拟用户付款：渠道侧记为已付，并生成签名回调请求（调用方可以不投递，模拟回调丢失） */
  pay(orderNo: string): { paid: ChannelPaid; notify: Request } | null;
  /** 测试用：最近一次 createPayment 收到的参数 */
  readonly lastCreate: CreatePaymentInput | null;
}

export function createMockProvider(opts: { siteUrl: string; secret?: Buffer }): MockProvider {
  const secret = opts.secret ?? randomBytes(32);
  const created = new Map<string, CreatePaymentInput>();
  const paid = new Map<string, ChannelPaid>();
  const closed = new Set<string>();
  let lastCreate: CreatePaymentInput | null = null;
  const sign = (body: string): string => createHmac('sha256', secret).update(body).digest('hex');

  return {
    channel: 'mock',
    get lastCreate() {
      return lastCreate;
    },
    async createPayment(input): Promise<PayParams> {
      lastCreate = input;
      created.set(input.orderNo, input);
      return { kind: 'redirect', url: `/pay/mock?o=${encodeURIComponent(input.orderNo)}` };
    },
    pay(orderNo) {
      const c = created.get(orderNo);
      if (!c || closed.has(orderNo)) return null;
      const p = paid.get(orderNo) ?? {
        orderNo,
        amountFen: c.amountFen,
        channelTxnId: `MOCK${randomBytes(8).toString('hex')}`,
      };
      paid.set(orderNo, p);
      const body = JSON.stringify({ event: 'paid', ...p });
      const notify = new Request(new URL(c.notifyUrl, opts.siteUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-signature': sign(body) },
        body,
      });
      return { paid: p, notify };
    },
    async verifyNotify(req): Promise<NotifyResult> {
      const ack = (ok: boolean) => Response.json({ ok }, { status: ok ? 200 : 400 });
      const body = await req.text();
      const sig = req.headers.get('x-mock-signature') ?? '';
      const expect = sign(body);
      if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect)))
        return { paid: null, ack };
      try {
        const j = JSON.parse(body) as Partial<ChannelPaid> & { event?: string };
        if (
          j.event !== 'paid' ||
          typeof j.orderNo !== 'string' ||
          typeof j.amountFen !== 'number' ||
          typeof j.channelTxnId !== 'string'
        )
          return { paid: null, ack };
        return {
          paid: { orderNo: j.orderNo, amountFen: j.amountFen, channelTxnId: j.channelTxnId },
          ack,
        };
      } catch {
        return { paid: null, ack };
      }
    },
    async queryOrder(orderNo) {
      return paid.get(orderNo) ?? null;
    },
    async closeOrder(orderNo) {
      closed.add(orderNo);
    },
  };
}
