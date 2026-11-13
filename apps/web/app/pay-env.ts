/**
 * 支付环境识别与支付方式（TASKS T48；ARCHITECTURE §8.2，UI.md §6.1）。纯函数，便于测试。
 *
 * 环境：微信内置浏览器 / 其他手机浏览器 / 电脑。支付方式按环境与「已开通渠道」决定，只开通一家时按 §6.1 退化。
 * PAYMENT_MODE=mock 时已开通渠道只有 mock：界面仍按环境显示真实的按钮文案，下单统一走 mock。
 */
import type { Channel } from '../server/orders/schema';

export type PayEnv = 'wechat' | 'mobile' | 'desktop';

export function detectEnv(ua: string): PayEnv {
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/Mobi|Android|iPhone|iPad|iPod|HarmonyOS/i.test(ua)) return 'mobile';
  return 'desktop';
}

export type PayAction =
  /** 下单并按返回的调起参数支付 */
  | { kind: 'pay'; channel: Channel; label: string; tone: 'wechat' | 'alipay' }
  /** 复制当前链接，到微信中打开 */
  | { kind: 'copy-to-wechat'; label: string }
  /** 微信内引导「在浏览器打开」以使用支付宝 */
  | { kind: 'open-in-browser'; label: string };

const has = (chs: readonly Channel[], c: Channel): boolean =>
  chs.includes(c) || chs.includes('mock');
const real = (chs: readonly Channel[], c: Channel): Channel => (chs.includes('mock') ? 'mock' : c);

export interface PayOptions {
  /** 主操作（手机：大按钮；电脑：默认标签） */
  primary: PayAction | null;
  /** 次操作（分隔线「想用微信支付」下方） */
  secondary: PayAction | null;
}

export function payOptions(env: PayEnv, channels: readonly Channel[]): PayOptions {
  const wxJs = has(channels, 'wechat_jsapi');
  const wxNative = has(channels, 'wechat_native');
  const aliWap = has(channels, 'alipay_wap');
  const aliPage = has(channels, 'alipay_page');
  const copy: PayAction = { kind: 'copy-to-wechat', label: '复制链接，到微信中打开' };
  if (env === 'wechat') {
    if (wxJs)
      return {
        primary: {
          kind: 'pay',
          channel: real(channels, 'wechat_jsapi'),
          label: '微信支付 ¥9.9',
          tone: 'wechat',
        },
        secondary: null,
      };
    if (aliWap)
      return {
        primary: { kind: 'open-in-browser', label: '在浏览器中打开以支付宝支付' },
        secondary: null,
      };
    return { primary: null, secondary: null };
  }
  if (env === 'mobile') {
    if (aliWap)
      return {
        primary: {
          kind: 'pay',
          channel: real(channels, 'alipay_wap'),
          label: '支付宝支付 ¥9.9',
          tone: 'alipay',
        },
        secondary: wxJs ? copy : null,
      };
    if (wxJs) return { primary: copy, secondary: null };
    return { primary: null, secondary: null };
  }
  // 电脑：默认微信扫码，可切支付宝
  const wx: PayAction | null = wxNative
    ? { kind: 'pay', channel: real(channels, 'wechat_native'), label: '微信扫码', tone: 'wechat' }
    : null;
  const ali: PayAction | null = aliPage
    ? { kind: 'pay', channel: real(channels, 'alipay_page'), label: '支付宝', tone: 'alipay' }
    : null;
  return { primary: wx ?? ali, secondary: wx ? ali : null };
}

/** 支付返回页用：localStorage 里保存载荷的键（只在用户设备上） */
export const pendingKey = (orderNo: string): string => `pending:${orderNo}`;
