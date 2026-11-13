/** 生产启动预加载（由 instrumentation.ts 在 Node 运行时调用）：任何一项配置错误打印原因并退出进程。 */
import { appContext } from './app-context';

export function startup(): void {
  if (process.env.NODE_ENV !== 'production') return;
  try {
    appContext();
  } catch (e) {
    console.error(`启动失败：${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
