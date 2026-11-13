/**
 * 页脚免责组件（TASKS T46）：首页、结果页、报告页共用。E2E 用 data-testid="legal-footer" 断言三类页面都有。
 */
import Link from 'next/link';
import { DISCLAIMER_SHORT } from './legal-content';

export function LegalFooter({ variant = 'short' }: { variant?: 'short' | 'result' }) {
  return (
    <footer
      className={`foot${variant === 'result' ? ' foot-result' : ''}`}
      data-testid="legal-footer"
    >
      {variant === 'result' ? (
        <>
          本页内容由代码按固定规则计算，仅作传统文化参考与娱乐，
          <br />
          不构成医疗、投资、法律等任何专业建议。
          <br />
        </>
      ) : (
        <>{DISCLAIMER_SHORT} · </>
      )}
      <Link href="/privacy">隐私说明</Link> · <Link href="/disclaimer">免责声明</Link>
      {variant === 'result' ? ' · 你的出生信息不会被保存' : ''}
    </footer>
  );
}
