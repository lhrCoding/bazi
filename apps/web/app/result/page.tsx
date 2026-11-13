/** 免费结果页 /result#<载荷>（TASKS T45）。载荷在片段里，只能在浏览器读取，页面主体是客户端组件。 */
import type { Metadata } from 'next';
import { ResultView } from './result-view';

export const metadata: Metadata = {
  title: '八字结果 · 一元知命',
  // 结果页内容因人而异，不让搜索引擎收录
  robots: { index: false, follow: false },
};

export default function ResultPage() {
  return <ResultView />;
}
