/**
 * Next 启动钩子（TASKS T53；HANDOFF 技术债「initTextsStoreOrExit 未接入启动流程」）。
 * 生产启动时预加载订单库、指纹密钥、素材库与报告资源，配置错误立即退出（实现见 server/startup.ts，只在 Node 运行时加载）。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startup } = await import('./server/startup');
    startup();
  }
}
