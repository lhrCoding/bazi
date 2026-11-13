/** T48 支付环境识别与支付方式（ARCHITECTURE §8.2，UI.md §6.1 含只开通一家的退化）。 */
import { describe, expect, it } from 'vitest';
import { detectEnv, payOptions } from '../app/pay-env';

const UA = {
  wechat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
};
const ALL = ['wechat_jsapi', 'wechat_native', 'alipay_wap', 'alipay_page'] as const;

describe('环境识别', () => {
  it('微信内 / 手机 / 电脑', () => {
    expect(detectEnv(UA.wechat)).toBe('wechat');
    expect(detectEnv(UA.safari)).toBe('mobile');
    expect(detectEnv(UA.android)).toBe('mobile');
    expect(detectEnv(UA.desktop)).toBe('desktop');
  });
});

describe('支付方式', () => {
  it('全部开通：微信内=微信支付；手机=支付宝 + 复制到微信；电脑=微信扫码 + 支付宝', () => {
    expect(payOptions('wechat', ALL)).toEqual({
      primary: { kind: 'pay', channel: 'wechat_jsapi', label: '微信支付 ¥9.9', tone: 'wechat' },
      secondary: null,
    });
    const m = payOptions('mobile', ALL);
    expect(m.primary).toMatchObject({ channel: 'alipay_wap', label: '支付宝支付 ¥9.9' });
    expect(m.secondary).toMatchObject({ kind: 'copy-to-wechat' });
    const d = payOptions('desktop', ALL);
    expect(d.primary).toMatchObject({ channel: 'wechat_native', label: '微信扫码' });
    expect(d.secondary).toMatchObject({ channel: 'alipay_page', label: '支付宝' });
  });
  it('只有微信：手机主按钮换成复制到微信；电脑只有微信码', () => {
    const wx = ['wechat_jsapi', 'wechat_native'] as const;
    expect(payOptions('mobile', wx)).toEqual({
      primary: { kind: 'copy-to-wechat', label: '复制链接，到微信中打开' },
      secondary: null,
    });
    expect(payOptions('desktop', wx).secondary).toBeNull();
  });
  it('只有支付宝：微信内引导在浏览器打开；手机无复制按钮', () => {
    const ali = ['alipay_wap', 'alipay_page'] as const;
    expect(payOptions('wechat', ali).primary).toMatchObject({ kind: 'open-in-browser' });
    expect(payOptions('mobile', ali).secondary).toBeNull();
    expect(payOptions('desktop', ali).primary).toMatchObject({ channel: 'alipay_page' });
  });
  it('mock：按钮文案按环境，下单渠道统一 mock；都没开通时无按钮', () => {
    expect(payOptions('wechat', ['mock']).primary).toMatchObject({
      channel: 'mock',
      label: '微信支付 ¥9.9',
    });
    expect(payOptions('mobile', ['mock']).primary).toMatchObject({
      channel: 'mock',
      label: '支付宝支付 ¥9.9',
    });
    expect(payOptions('desktop', ['mock']).primary).toMatchObject({
      channel: 'mock',
      label: '微信扫码',
    });
    expect(payOptions('mobile', [])).toEqual({ primary: null, secondary: null });
  });
});
