/**
 * 免费结果页数据（TASKS T43；rules/report-sections.md §1 R-FREE，strength.md §5，calendar.md §4 / §7）。
 *
 * 只含 4 个模块：四柱八字、五行强弱、日主旺衰、喜用 / 忌神；附属信息：真太阳时说明或未校正灰字、三柱置信度灰字、
 * 交节日提示、三柱缺失说明。**不含**性格画像、吉神、大运 / 流年年份、章节摘要（FREE_RESULT_KEYS 白名单，测试比对）。
 *
 * 句式按 §1 逐字实现为代码模板（texts/free.yaml 尚未撰写，属第 3 批素材；写好后改为从素材库读取，句式须保持一致）。
 * 交节提示 calendar.md §7 原文用「您」，按文字规范（L12）改为「你」。
 */
import type { Chart } from '../bazi/types';
import type { Analysis, WuXing } from '../rules/types';
import { TST_NEAR_BOUNDARY, TST_UNCORRECTED } from './assemble';

export const FREE_CONFIDENCE_TEXT = {
  高: null,
  中: '时辰未知，此结论大概率成立。',
  低: '时辰未知，此项仅供参考。',
} as const;

export interface FreeResult {
  engineVersion: string;
  hourKnown: boolean;
  pillars: {
    /** 年 / 月 / 日 / 时柱干支；时辰未知为「未知」 */
    ganzhi: [string, string, string, string];
    /** 天干十神（日柱为「日主」） */
    stemGods: [string, string, string, string];
    /** 地支藏干「干（十神）」 */
    hidden: [string[], string[], string[], string[]];
    /** 真太阳时说明（选了出生地）或未校正灰字；三柱为 null */
    tstNotice: string | null;
    /** 交节日无时辰：交节时刻（北京时间）与当前采用的一侧；否则 null */
    jieqi: {
      time: string;
      name: string;
      side: 'before' | 'after' | null;
      prompt: string;
      /** 选「之前 / 之后」时的年柱、月柱（由调用方另排两次盘得到，T45 结果页按钮上直接写出） */
      options: { before: [string, string]; after: [string, string] } | null;
    } | null;
    /** 所选出生地全称（输入回显、真太阳时说明用）；未选为 null */
    placeName: string | null;
  };
  power: {
    data: { element: WuXing; pct: number }[];
    dayElement: WuXing;
    /** 帮扶（同党）百分比 */
    supportPct: number;
    sentence: string;
  };
  strength: {
    level: string;
    /** 从格 / 专旺子类型（如「从财」）；结果页把四档刻度换成「从财格」标签 */
    special: string | null;
    /** 三个「得」：得令、得地、得势（天干帮手个数） */
    deLing: boolean;
    deDi: boolean;
    deShi: number;
    sentence: string;
    /** 三柱置信度灰字；有时辰或置信「高」为 null */
    confidenceNote: string | null;
  };
  yongshen: {
    yong: WuXing;
    xi: WuXing[];
    ji: WuXing[];
    sentence: string;
    confidenceNote: string | null;
  };
  /** 三柱缺失说明（付费按钮旁显示）；有时辰为 null */
  nohourNotice: string | null;
}

/** 顶层字段白名单（P0-4：免费页只展示 4 个模块） */
export const FREE_RESULT_KEYS: readonly (keyof FreeResult)[] = [
  'engineVersion',
  'hourKnown',
  'pillars',
  'power',
  'strength',
  'yongshen',
  'nohourNotice',
];

const ORDER = ['木', '火', '土', '金', '水'] as const;

export interface FreeResultExtra {
  /** 交节日无时辰：另按「之前 / 之后」排的盘 */
  jieqiAlt?: { before: Chart; after: Chart };
  placeName?: string | null;
}

export function buildFreeResult(
  chart: Chart,
  analysis: Analysis,
  extra: FreeResultExtra = {},
): FreeResult {
  const st = analysis.strength;
  const ys = analysis.yongshen;
  const keys = ['year', 'month', 'day', 'hour'] as const;
  const supportPct = Math.round(st.S * 100);
  const dayGan = chart.pillars.day[0] as string;
  const dayEl = st.day_master.element;

  let tstNotice: string | null = null;
  if (chart.hourKnown) {
    if (chart.tst_status === '已校正' && chart.true_solar_time) {
      const t = chart.true_solar_time;
      const sign = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;
      tstNotice =
        `北京时间 ${t.beijingTime.slice(11)} → 真太阳时 ${t.trueSolarTime.slice(11)}` +
        `（经度修正 ${sign(t.longitudeCorrectionMin)} 分、均时差 ${sign(t.equationOfTimeMin)} 分）`;
    } else {
      tstNotice = chart.near_shichen_boundary
        ? `${TST_UNCORRECTED}${TST_NEAR_BOUNDARY}`
        : TST_UNCORRECTED;
    }
  }

  const jb = chart.jieqi_on_birthday;
  const jieqi =
    !chart.hourKnown && jb
      ? {
          time: jb.time.slice(11, 16),
          name: jb.name,
          side: chart.jieqi_side,
          prompt: `你出生当天 ${jb.time.slice(11, 16)} 交节（${jb.name}），若知道出生在此之前或之后，结果会更准。`,
          options: extra.jieqiAlt
            ? {
                before: [
                  extra.jieqiAlt.before.pillars.year,
                  extra.jieqiAlt.before.pillars.month,
                ] as [string, string],
                after: [extra.jieqiAlt.after.pillars.year, extra.jieqiAlt.after.pillars.month] as [
                  string,
                  string,
                ],
              }
            : null,
        }
      : null;

  const conf = analysis.confidence;
  const confidenceNote = chart.hourKnown ? null : FREE_CONFIDENCE_TEXT[conf];
  const deLing = st.de_ling ? '得令' : '失令';
  const favorable = [`${ys.yong}（主）`, ...ys.xi].join('、');

  return {
    engineVersion: chart.engineVersion,
    hourKnown: chart.hourKnown,
    pillars: {
      ganzhi: keys.map((k) => chart.pillars[k] ?? '未知') as FreeResult['pillars']['ganzhi'],
      stemGods: keys.map((k) =>
        k === 'day' ? '日主' : (chart.ten_gods[k] ?? '未知'),
      ) as FreeResult['pillars']['stemGods'],
      hidden: keys.map((k) =>
        (chart.hidden_stems[k] ?? []).map((h) => `${h.gan}（${h.ten_god}）`),
      ) as FreeResult['pillars']['hidden'],
      tstNotice,
      jieqi,
      placeName: extra.placeName ?? null,
    },
    power: {
      data: ORDER.map((w) => ({ element: w, pct: Math.round(st.power_display_pct[w]) })),
      dayElement: dayEl,
      supportPct,
      sentence: `帮扶你的力量占 ${supportPct}%`,
    },
    strength: {
      level: st.level,
      special: st.special,
      deLing: st.de_ling,
      deDi: st.de_di,
      deShi: st.de_shi,
      sentence: `${dayGan}${dayEl}生于${chart.pillars.month[1]}月，${deLing}，帮扶力量占 ${supportPct}%，属${st.level}。`,
      confidenceNote,
    },
    yongshen: {
      yong: ys.yong,
      xi: [...ys.xi],
      ji: [...ys.ji],
      sentence: `对你有利的五行：${favorable}；需要节制的五行：${ys.ji.join('、')}。`,
      confidenceNote,
    },
    nohourNotice: chart.hourKnown
      ? null
      : `未提供出生时辰：报告按三柱分析。缺少：① 时柱相关内容（时柱十神、流年与时柱的冲合）；` +
        `② 旺衰与喜用神的可信度为「${conf}」；③ 起运年龄为估算（误差约 ±4 个月）。`,
  };
}
