/**
 * ⑥ 支付抽象（TASKS T47；ARCHITECTURE §4.6、§6.2）。
 *
 * 发给渠道的只有：订单号、金额、固定商品描述、回调 / 返回地址、客户端 IP（微信 / 支付宝要求）、openid（微信 JSAPI）。
 * **出生信息、载荷、指纹永远不进 CreatePaymentInput**（类型层面就没有这些字段；测试再断言一遍）。
 * 不使用 attach / passback_params 等附加字段。
 */
import type { Channel } from '../orders/schema';

export const PAY_DESCRIPTION = '八字命盘报告';

export interface CreatePaymentInput {
  orderNo: string;
  amountFen: number;
  description: typeof PAY_DESCRIPTION;
  /** 渠道异步通知地址 /api/pay/notify/<渠道> */
  notifyUrl: string;
  /** 支付完成后的返回页 /pay/done?o=<订单号>（只带订单号） */
  returnUrl: string;
  clientIp: string;
  /** 微信 JSAPI 需要；其他渠道为 null */
  openid: string | null;
}

/** 前端调起参数 */
export type PayParams =
  | { kind: 'redirect'; url: string }
  | { kind: 'qrcode'; codeUrl: string }
  | { kind: 'jsapi'; params: Readonly<Record<string, string>> };

/** 验签通过的支付成功通知 / 查单结果 */
export interface ChannelPaid {
  orderNo: string;
  amountFen: number;
  channelTxnId: string;
}

export interface NotifyResult {
  /** 验签失败 / 非成功状态为 null */
  paid: ChannelPaid | null;
  /** 回给渠道的应答（各渠道格式不同） */
  ack: (ok: boolean) => Response;
}

export interface PaymentProvider {
  readonly channel: Channel;
  createPayment(input: CreatePaymentInput): Promise<PayParams>;
  /** 验签、解密回调；不抛异常，失败返回 paid = null */
  verifyNotify(req: Request): Promise<NotifyResult>;
  /** 主动查单；未支付返回 null */
  queryOrder(orderNo: string): Promise<ChannelPaid | null>;
  closeOrder(orderNo: string): Promise<void>;
}
