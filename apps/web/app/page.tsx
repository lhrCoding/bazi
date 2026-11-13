/**
 * 首页（TASKS T44；UI.md §4）。服务端组件：算好农历月份表（闰月、大小月）传给表单，浏览器不加载历法库。
 */
import { lunarMonthsOf } from '@zhiming/core';
import { BirthForm } from './birth-form';
import { LegalFooter } from './legal-footer';
import { MIN_YEAR, type LunarMonth } from './birth-form-logic';

function lunarTable(thisYear: number): Record<number, LunarMonth[]> {
  const t: Record<number, LunarMonth[]> = {};
  for (let y = MIN_YEAR; y <= thisYear; y++) {
    t[y] = lunarMonthsOf(y).map((o) => ({
      m: o.month,
      leap: o.isLeap,
      label: o.label,
      days: o.dayCount,
    }));
  }
  return t;
}

export default function HomePage() {
  const thisYear = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(
      new Date(),
    ),
  );
  return (
    <div className="wrap">
      <header className="top">
        <span className="seal">知命</span>
        <span className="name">知命</span>
      </header>
      <div className="intro">
        <h1>输入生辰，看你的八字</h1>
        <p>免费排出四柱与五行喜忌。代码按节气精确排盘，同一生日结果永远一致。</p>
      </div>
      <BirthForm lunar={lunarTable(thisYear)} thisYear={thisYear} />
      <LegalFooter />
    </div>
  );
}
