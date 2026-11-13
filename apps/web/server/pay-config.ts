/**
 * 已开通的支付渠道（TASKS T48）：只看环境变量，不打开数据库，供页面渲染时决定显示哪些支付按钮。
 * mock 模式下只有 mock；真实渠道在 T49–T51 接入后按各自的密钥是否齐全加入。
 */
import type { Channel } from './orders/schema';

export function enabledChannels(env: NodeJS.ProcessEnv): Channel[] {
  const mode = env.PAYMENT_MODE ?? 'mock';
  if (mode === 'mock') {
    const prod = env.NODE_ENV === 'production' && env.ALLOW_MOCK_PAYMENT !== '1';
    return prod ? [] : ['mock'];
  }
  return [];
}
