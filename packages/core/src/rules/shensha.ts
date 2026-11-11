/**
 * 吉神（TASKS T19；rules/shensha.md v1.1）。
 *
 * - 只展示 4 个吉神，固定顺序：天乙贵人、月德贵人、文昌贵人、太极贵人（§2）。
 * - 天乙 / 文昌 / 太极：分别以日干、年干（日干在前）查四柱全部地支（含本柱）；三柱不查时柱。
 * - 月德：以月支查四柱全部天干（含日干本身），by 恒为 ['月支']。
 * - 去重：同一吉神同一位置只出现一次，日干、年干都查到时 by = ['日干', '年干']；hits 按 年 → 月 → 日 → 时 排序。
 * - 交节日 + 无时辰 + 未选前后（uncertain.month_pillar 非空）：两组年月柱各查一次，jishen_display 只保留
 *   两组都命中的「吉神名 + 位置」，by 只保留两组都成立的来源；完整结果（默认一组）放 jishen。
 * - SS-SCOPE：本模块输出不进入旺衰、喜用神、评分的任何输入（analyze 中最后计算，且只读 pillars）。
 */
import type { Gan, GanZhi, Zhi } from '../bazi/ganzhi';
import type { Chart, Pillars } from '../bazi/types';
import type { Jishen, JishenHit, JishenName, ShenshaBy, ShenshaPos } from './types';

// ---------- §1 四张表（rules-params / shensha.test.ts 与 md 表格比对） ----------
/** §1.1 天乙贵人：起查天干 → 地支 */
export const TIANYI: Readonly<Record<Gan, readonly Zhi[]>> = {
  甲: ['丑', '未'],
  乙: ['子', '申'],
  丙: ['亥', '酉'],
  丁: ['亥', '酉'],
  戊: ['丑', '未'],
  己: ['子', '申'],
  庚: ['丑', '未'],
  辛: ['寅', '午'],
  壬: ['卯', '巳'],
  癸: ['卯', '巳'],
};

/** §1.2 太极贵人：起查天干 → 地支 */
export const TAIJI: Readonly<Record<Gan, readonly Zhi[]>> = {
  甲: ['子', '午'],
  乙: ['子', '午'],
  丙: ['卯', '酉'],
  丁: ['卯', '酉'],
  戊: ['辰', '戌', '丑', '未'],
  己: ['辰', '戌', '丑', '未'],
  庚: ['寅', '亥'],
  辛: ['寅', '亥'],
  壬: ['巳', '申'],
  癸: ['巳', '申'],
};

/** §1.3 文昌贵人：起查天干 → 地支 */
export const WENCHANG: Readonly<Record<Gan, Zhi>> = {
  甲: '巳',
  乙: '午',
  丙: '申',
  丁: '酉',
  戊: '申',
  己: '酉',
  庚: '亥',
  辛: '子',
  壬: '寅',
  癸: '卯',
};

/** §1.4 月德贵人：月支 → 天干 */
export const YUEDE: Readonly<Record<Zhi, Gan>> = {
  寅: '丙',
  午: '丙',
  戌: '丙',
  申: '壬',
  子: '壬',
  辰: '壬',
  亥: '甲',
  卯: '甲',
  未: '甲',
  巳: '庚',
  酉: '庚',
  丑: '庚',
};

/** §2 固定展示顺序 */
export const JISHEN_ORDER: readonly JishenName[] = ['天乙贵人', '月德贵人', '文昌贵人', '太极贵人'];

const PILLAR_KEYS = ['year', 'month', 'day', 'hour'] as const;
const ZHI_POS: readonly ShenshaPos[] = ['年支', '月支', '日支', '时支'];
const GAN_POS: readonly ShenshaPos[] = ['年干', '月干', '日干', '时干'];

function branchTable(name: JishenName): (gan: Gan) => readonly Zhi[] {
  if (name === '天乙贵人') return (g) => TIANYI[g];
  if (name === '太极贵人') return (g) => TAIJI[g];
  return (g) => [WENCHANG[g]];
}

/** 按 §2 伪代码查一组柱的吉神。 */
export function computeJishen(pillars: Pillars): Jishen[] {
  const cols = PILLAR_KEYS.map((k) => pillars[k]);
  const out: Jishen[] = [];
  for (const name of JISHEN_ORDER) {
    // 位置序号（0–3）→ 起查来源
    const hits = new Map<number, ShenshaBy[]>();
    if (name === '月德贵人') {
      const gan = YUEDE[pillars.month[1] as Zhi];
      cols.forEach((gz, i) => {
        if (gz !== null && gz[0] === gan) hits.set(i, ['月支']);
      });
    } else {
      const table = branchTable(name);
      const sources: [ShenshaBy, Gan][] = [
        ['日干', pillars.day[0] as Gan],
        ['年干', pillars.year[0] as Gan],
      ];
      for (const [by, gan] of sources) {
        const targets = table(gan);
        cols.forEach((gz, i) => {
          if (gz === null || !targets.includes(gz[1] as Zhi)) return;
          const list = hits.get(i) ?? [];
          if (!list.includes(by)) list.push(by);
          hits.set(i, list);
        });
      }
    }
    if (hits.size > 0) {
      const pos = name === '月德贵人' ? GAN_POS : ZHI_POS;
      const sorted = [...hits.entries()].sort((a, b) => a[0] - b[0]);
      out.push({ name, hits: sorted.map(([i, by]) => ({ pos: pos[i] as ShenshaPos, by })) });
    }
  }
  return out;
}

/** 两组结果的共有部分：吉神名 + 位置都命中，by 取交集（保持第一组顺序）；交集为空的位置不保留。 */
export function intersectJishen(a: readonly Jishen[], b: readonly Jishen[]): Jishen[] {
  const out: Jishen[] = [];
  for (const ja of a) {
    const jb = b.find((x) => x.name === ja.name);
    if (!jb) continue;
    const hits: JishenHit[] = [];
    for (const ha of ja.hits) {
      const hb = jb.hits.find((x) => x.pos === ha.pos);
      if (!hb) continue;
      const by = ha.by.filter((s) => hb.by.includes(s));
      if (by.length > 0) hits.push({ pos: ha.pos, by });
    }
    if (hits.length > 0) out.push({ name: ja.name, hits });
  }
  return out;
}

export interface Shensha {
  /** 默认一组柱（Chart.pillars）的完整结果 */
  jishen: Jishen[];
  /** 报告展示用：无交节不确定时等于 jishen；交节日三柱且未选前后时为两组共有部分 */
  jishen_display: Jishen[];
}

/** uncertain 缺省视为无交节不确定。 */
export function computeShensha(
  chart: Pick<Chart, 'pillars'> & Partial<Pick<Chart, 'uncertain'>>,
): Shensha {
  const { pillars } = chart;
  const jishen = computeJishen(pillars);
  const mp = chart.uncertain?.month_pillar ?? null;
  if (mp === null) return { jishen, jishen_display: jishen };
  const other = mp.find(([y, m]) => !(y === pillars.year && m === pillars.month));
  if (other === undefined) throw new Error('uncertain.month_pillar 中找不到另一组年月柱');
  const [year, month] = other as [GanZhi, GanZhi];
  const alt = computeJishen({ ...pillars, year, month });
  return { jishen, jishen_display: intersectJishen(jishen, alt) };
}
