/**
 * 章节拼装（TASKS T31：第 0–4 章与代码模板；T32 续写第 5–8 章）。
 * rules/report-sections.md §2–§4、§6，yongshen.md §7，shensha.md §3–§4，calendar.md §4，ARCHITECTURE §4.3.6。
 *
 * 输出结构化 JSON（不是 HTML）：Report { meta, chapters: [{ id, title, blocks }], events }。
 * 段落块：选段（select.ts）→ 选变体 → 占位符（render.ts）→ 全报告术语首次加注 → 依据（basisFor）→ 古籍引文
 * （一章 ≤ 1 句、全报告 ≤ 5 句；引文不加注、不送润色）。
 * 代码模板（不走素材）：第 0 章命盘表 / 真太阳时说明 / 三柱缺失说明 / 吉神小表 / 规则版本号，CH2-SUMMARY，
 * CH3-PERSONA-LINE，CH4-TABLE，置信「低」时的「另一种可能」句与第 4 章前置提示句。
 * 吉神只出现在第 0 章小表与第 3 章 CH3-SHENSHA（shensha.md §3）。
 */
import type { Gan, Zhi } from '../bazi/ganzhi';
import type { TenGod } from '../bazi/ten-gods';
import type { Chart } from '../bazi/types';
import type { Analysis, JishenName, WuXing } from '../rules/types';
import { RULES_VERSION } from '../rules/version';
import type { TextEntry } from '../texts/schema';
import type { Ctx } from './ctx';
import { Annotator, basisFor, renderText, type GlossaryTerm } from './render';
import { selectSlot, VariantChooser, type TextLibrary } from './select';
import { slotDef } from './slots';

// ---------------------------------------------------------------- 输出结构

export interface ParaBlock {
  type: 'para';
  slot: string;
  /** 素材条目 id；代码模板段为 null */
  entry: string | null;
  text: string;
  /** 「依据：」之后的文字；null = 不追加 */
  basis: string | null;
  quote?: { text: string; source: string };
}
export interface NoticeBlock {
  type: 'notice';
  kind: 'tst' | 'nohour' | 'rules_version' | 'shensha_note' | 'alt_possibility' | 'advice_premise';
  text: string;
}
export interface TableBlock {
  type: 'table';
  kind: 'chart' | 'shensha' | 'advice';
  columns: string[];
  rows: string[][];
}
export interface ChartBlock {
  type: 'chart';
  kind: 'power';
  data: { element: WuXing; pct: number }[];
}
export type Block = ParaBlock | NoticeBlock | TableBlock | ChartBlock;

export interface Chapter {
  id: number;
  title: string;
  blocks: Block[];
}

export type ReportEvent =
  { type: 'fallback_used'; slot: string } | { type: 'slot_empty'; slot: string };

export const CHAPTER_TITLES: readonly string[] = [
  '命盘总览',
  '你的日主与旺衰',
  '喜用神详解',
  '性格与天赋',
  '适合的行业 / 颜色 / 方位 / 数字',
  '十年大运',
  '未来 5 年逐年流年',
  '事业 / 财运 / 感情 / 健康',
  '方法说明与免责声明',
];

export const MAX_QUOTES_PER_CHAPTER = 1;
export const MAX_QUOTES_PER_REPORT = 5;

// ---------------------------------------------------------------- 常量（规则文档原文）

/** shensha.md §4 固定释义 */
export const JISHEN_NOTES: Readonly<Record<JishenName, string>> = {
  天乙贵人: '传统上被视为最重要的吉神，象征容易得到他人帮助与提携。',
  月德贵人: '传统上象征为人宽厚、处事平顺。',
  文昌贵人: '传统上象征聪敏好学，利于读书与考试。',
  太极贵人: '传统上象征悟性好，对哲理、玄学、研究类事物有兴趣。',
};
/** shensha.md §3 第 0 章表下固定灰字 */
export const SHENSHA_FOOTNOTE =
  '吉神为传统文化中的象征性说法，以日干、年干查得，多数命盘都有一个或几个；本报告的旺衰与喜用判断不使用它。';
/** calendar.md §4 未校正灰字与临界提示 */
export const TST_UNCORRECTED =
  '时辰按北京时间排定，未做真太阳时校正。如出生地离东经 120° 较远，时柱可能不同，可补充出生地重新排盘。';
export const TST_NEAR_BOUNDARY = '你的出生时间接近时辰交界，补充出生地后时柱可能变化。';
/** report-sections.md §6.1 日干意象 */
export const DAY_IMAGE: Readonly<Record<Gan, string>> = {
  甲: '大树',
  乙: '花草藤蔓',
  丙: '太阳',
  丁: '烛火',
  戊: '高山',
  己: '田园',
  庚: '刀剑矿石',
  辛: '珠玉',
  壬: '江河',
  癸: '雨露',
};
/** report-sections.md §6.2 十神关键词（第一个） */
export const TEN_GOD_KEYWORD: Readonly<Record<TenGod, string>> = {
  比肩: '独立',
  劫财: '行动快',
  食神: '温和',
  伤官: '才华外露',
  偏财: '灵活',
  正财: '踏实',
  七杀: '有魄力',
  正官: '自律',
  偏印: '思维独特',
  正印: '善良',
};
/** report-sections.md §6 旺衰短语 */
export const LEVEL_PHRASE: Readonly<Record<string, string>> = {
  身旺: '自我驱动力强',
  中和偏旺: '状态均衡、略偏主动',
  中和偏弱: '状态均衡、懂得借力',
  身弱: '善于合作、借势而行',
  从弱: '顺势而为、适应力强',
  从强: '专注一门、能量集中',
};
/** yongshen.md §7 */
export const ADVICE: Readonly<
  Record<
    WuXing,
    { color: string; direction: string; numbers: string; industries: string; season: string }
  >
> = {
  木: {
    color: '绿、青',
    direction: '东',
    numbers: '3、8',
    industries: '教育、出版、设计、园艺/农林、医药健康服务',
    season: '春',
  },
  火: {
    color: '红、紫、橙',
    direction: '南',
    numbers: '2、7',
    industries: '互联网/传媒、能源、餐饮、演艺、美业',
    season: '夏',
  },
  土: {
    color: '黄、棕、米色',
    direction: '中/本地、东北、西南',
    numbers: '5、0',
    industries: '房地产/建筑、农业、仓储物流、行政管理、咨询',
    season: '四季末',
  },
  金: {
    color: '白、金、银',
    direction: '西',
    numbers: '4、9',
    industries: '金融、法律、机械/制造、IT 硬件、精密技术',
    season: '秋',
  },
  水: {
    color: '黑、蓝、灰',
    direction: '北',
    numbers: '1、6',
    industries: '贸易、运输/航运、旅游、咨询策划、水产/饮品',
    season: '冬',
  },
};
export const ADVICE_PREMISE = '以下建议建立在上述喜用神之上。';

// ---------------------------------------------------------------- 拼装器

export interface AssembleInput {
  chart: Chart;
  analysis: Analysis;
  ctx: Ctx;
  library: TextLibrary;
  glossary: readonly GlossaryTerm[];
}

/** 一份报告的拼装状态：变体计数、术语加注、引文计数、事件 */
export class ReportBuilder {
  readonly chooser: VariantChooser;
  readonly annotator: Annotator;
  readonly events: ReportEvent[] = [];
  private quotesInReport = 0;
  private quotesInChapter = 0;

  constructor(readonly input: AssembleInput) {
    this.chooser = new VariantChooser(input.ctx.chart_key);
    this.annotator = new Annotator(input.glossary);
  }

  get evalCtx(): Readonly<Record<string, unknown>> {
    return this.input.ctx as unknown as Readonly<Record<string, unknown>>;
  }

  startChapter(): void {
    this.quotesInChapter = 0;
  }

  /** 素材槽位 → 段落块（0–k 个）。basisItem 给依据用的 item（默认同 item） */
  slot(
    slotId: string,
    k: number,
    item?: Readonly<Record<string, unknown>>,
    basisItem = item,
  ): ParaBlock[] {
    const pick = selectSlot(this.input.library, slotId, this.evalCtx, k, item);
    if (pick.fallbackUsed) this.events.push({ type: 'fallback_used', slot: slotId });
    if (pick.entries.length === 0) {
      // 非必需槽位条件不成立是正常情况；只有必需槽位为空才记事件（素材缺口，生产启动检查会拦住）
      if (slotDef(slotId)?.required) this.events.push({ type: 'slot_empty', slot: slotId });
      return [];
    }
    return pick.entries.map((e) => this.para(slotId, e, item, basisItem));
  }

  private para(
    slotId: string,
    e: TextEntry,
    item: Readonly<Record<string, unknown>> | undefined,
    basisItem: Readonly<Record<string, unknown>> | undefined,
  ): ParaBlock {
    const chosen = this.chooser.choose(e);
    const text = this.annotator.annotate(renderText(chosen.text, this.evalCtx, item));
    const block: ParaBlock = {
      type: 'para',
      slot: slotId,
      entry: e.id,
      text,
      basis: basisFor(slotId, this.evalCtx, basisItem),
    };
    if (
      e.quote &&
      this.quotesInChapter < MAX_QUOTES_PER_CHAPTER &&
      this.quotesInReport < MAX_QUOTES_PER_REPORT
    ) {
      block.quote = { text: e.quote.text, source: e.quote.source };
      this.quotesInChapter++;
      this.quotesInReport++;
    }
    return block;
  }

  /** 代码模板段（同样参与术语加注） */
  codePara(slotId: string, text: string, annotate = true): ParaBlock {
    return {
      type: 'para',
      slot: slotId,
      entry: null,
      text: this.annotator.annotate(text, annotate),
      basis: basisFor(slotId, this.evalCtx),
    };
  }
}

// ---------------------------------------------------------------- 第 0 章

const PILLAR_NAMES = ['年柱', '月柱', '日柱', '时柱'] as const;
const PILLAR_KEYS = ['year', 'month', 'day', 'hour'] as const;

export function chapter0(b: ReportBuilder): Chapter {
  const { chart, analysis } = b.input;
  const blocks: Block[] = [];
  if (!chart.hourKnown) {
    blocks.push({
      type: 'notice',
      kind: 'nohour',
      text:
        `未提供出生时辰：报告按三柱分析。缺少：① 时柱相关内容（时柱十神、流年与时柱的冲合）；` +
        `② 旺衰与喜用神的可信度为「${analysis.confidence}」；③ 起运年龄为估算（误差约 ±4 个月）。`,
    });
  }
  blocks.push({
    type: 'table',
    kind: 'chart',
    columns: ['', ...PILLAR_NAMES],
    rows: [
      ['干支', ...PILLAR_KEYS.map((k) => chart.pillars[k] ?? '未知')],
      [
        '天干十神',
        ...PILLAR_KEYS.map((k) => (k === 'day' ? '日主' : (chart.ten_gods[k] ?? '未知'))),
      ],
      [
        '地支藏干',
        ...PILLAR_KEYS.map((k) => {
          const hs = chart.hidden_stems[k];
          return hs === null ? '未知' : hs.map((h) => `${h.gan}（${h.ten_god}）`).join('、');
        }),
      ],
    ],
  });
  if (chart.hourKnown) {
    if (chart.tst_status === '已校正' && chart.true_solar_time) {
      const t = chart.true_solar_time;
      const sign = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;
      blocks.push({
        type: 'notice',
        kind: 'tst',
        text:
          `北京时间 ${t.beijingTime.slice(11)} → 真太阳时 ${t.trueSolarTime.slice(11)}` +
          `（经度修正 ${sign(t.longitudeCorrectionMin)} 分、均时差 ${sign(t.equationOfTimeMin)} 分）`,
      });
    } else {
      blocks.push({
        type: 'notice',
        kind: 'tst',
        text: chart.near_shichen_boundary
          ? `${TST_UNCORRECTED}${TST_NEAR_BOUNDARY}`
          : TST_UNCORRECTED,
      });
    }
  }
  const js = analysis.shensha.jishen_display;
  if (js.length > 0) {
    blocks.push({
      type: 'table',
      kind: 'shensha',
      columns: ['吉神', '所在位置', '释义'],
      rows: js.map((j) => [
        j.name,
        j.hits
          .map((h) =>
            h.by.length === 2
              ? `${h.pos}（日干、年干均查得）`
              : `${h.pos}（${h.by[0] as string}查得）`,
          )
          .join('、'),
        JISHEN_NOTES[j.name],
      ]),
    });
    blocks.push({ type: 'notice', kind: 'shensha_note', text: SHENSHA_FOOTNOTE });
  }
  blocks.push({ type: 'notice', kind: 'rules_version', text: `规则版本 ${RULES_VERSION}` });
  return { id: 0, title: CHAPTER_TITLES[0] as string, blocks };
}

// ---------------------------------------------------------------- 第 1 章

/** 置信「低」的「另一种可能」句（report-sections.md §4 第 4 条） */
export function altPossibility(analysis: Analysis): string | null {
  if (analysis.confidence !== '低' || analysis.no_hour === null) return null;
  const nh = analysis.no_hour;
  if (nh.alt?.differs) {
    return `另一种可能：若出生在当天交节之后（年月柱为${nh.alt.pillars[0]}、${nh.alt.pillars[1]}），结论会偏向${nh.alt.level}，用神为${nh.alt.yong}。`;
  }
  const other = nh.slots.filter((s) => s.direction !== analysis.strength.direction);
  if (other.length === 0) return null;
  const hours = [...new Set(other.map((s) => `${s.hour[1] as Zhi}时`))];
  return `另一种可能：若出生于${hours.join('、')}，结论会偏向${other[0]?.direction}。`;
}

export function chapter1(b: ReportBuilder): Chapter {
  b.startChapter();
  const { analysis } = b.input;
  const blocks: Block[] = [...b.slot('CH1-DAYMASTER', 1), ...b.slot('CH1-MONTH', 1)];
  blocks.push({
    type: 'chart',
    kind: 'power',
    data: (['木', '火', '土', '金', '水'] as const).map((w) => ({
      element: w,
      pct: analysis.strength.power_display_pct[w],
    })),
  });
  blocks.push(...b.slot('CH1-BALANCE', 1));
  const alt = altPossibility(analysis);
  if (alt) blocks.push({ type: 'notice', kind: 'alt_possibility', text: alt });
  blocks.push(...b.slot('CH1-CONCLUSION', 1), ...b.slot('CH1-QUOTE', 1));
  return { id: 1, title: CHAPTER_TITLES[1] as string, blocks };
}

// ---------------------------------------------------------------- 第 2 章

export function summaryText(ctx: Ctx): string {
  const y = ctx.yongshen;
  const xian = y.xian.length > 0 ? `，${y.xian.join('、')}为闲神` : '';
  const low = ctx.profile.confidence === '低' ? '时辰未知，此结论仅供参考。' : '';
  return `综合以上，你的用神是${y.yong}，喜神是${y.xi.join('、')}，需要节制的是${y.ji.join('、')}${xian}。${low}`;
}

export function chapter2(b: ReportBuilder): Chapter {
  b.startChapter();
  const blocks: Block[] = [
    ...b.slot('CH2-METHOD', 1),
    ...b.slot('CH2-SWAP', 1),
    ...b.slot('CH2-TIAOHOU', 1),
    ...b.slot('CH2-TONGGUAN', 1),
    b.codePara('CH2-SUMMARY', summaryText(b.input.ctx)),
    ...b.slot('CH2-ROLE-YONG', 1),
    ...b.slot('CH2-ROLE-XI', 1),
    ...b.slot('CH2-ROLE-JI', 1),
    ...b.slot('CH2-NOHOUR-CONG', 1),
  ];
  return { id: 2, title: CHAPTER_TITLES[2] as string, blocks };
}

// ---------------------------------------------------------------- 第 3 章

export function personaLine(ctx: Ctx): string {
  const [a, c] = ctx.ten_gods.persona;
  const kws = [a, c].filter((x): x is TenGod => x !== undefined).map((t) => TEN_GOD_KEYWORD[t]);
  return `${DAY_IMAGE[ctx.day.stem]}：${kws.join('、')}，${LEVEL_PHRASE[ctx.strength.level] ?? ''}。`;
}

const GOD_OF: Readonly<Record<TenGod, string>> = {
  比肩: '比劫',
  劫财: '比劫',
  食神: '食伤',
  伤官: '食伤',
  偏财: '财',
  正财: '财',
  七杀: '官杀',
  正官: '官杀',
  偏印: '印',
  正印: '印',
};

/** CH3-GOD 的 item：十神、所属组、该组是否用喜、出现位置（天干月→年→时，再地支月→日→年→时） */
export function godItem(ctx: Ctx, tg: TenGod): Record<string, unknown> {
  const t = ctx.ten_gods;
  const where: [string, TenGod | null][] = [
    ['月干', t.month_stem],
    ['年干', t.year_stem],
    ['时干', t.hour_stem],
    ['月支', t.month_branch],
    ['日支', t.day_branch],
    ['年支', t.year_branch],
    ['时支', t.hour_branch],
  ];
  const god = GOD_OF[tg];
  return {
    ten_god: tg,
    god,
    is_favorable: ctx.yongshen.favorable.includes(ctx.el[god as keyof Ctx['el']]),
    pos: where.find(([, x]) => x === tg)?.[0] ?? '',
  };
}

export function chapter3(b: ReportBuilder): Chapter {
  b.startChapter();
  const { ctx, analysis } = b.input;
  const blocks: Block[] = [
    b.codePara('CH3-PERSONA-LINE', personaLine(ctx)),
    ...b.slot('CH3-BASE', 1),
  ];
  for (const tg of ctx.ten_gods.persona) blocks.push(...b.slot('CH3-GOD', 1, godItem(ctx, tg)));
  blocks.push(...b.slot('CH3-STYLE', 1), ...b.slot('CH3-TALENT', 1));
  const first = analysis.shensha.jishen_display[0];
  if (first) {
    const positions = first.hits.map((h) => h.pos).join('、');
    blocks.push(...b.slot('CH3-SHENSHA', 1, undefined, { name: first.name, positions }));
  }
  return { id: 3, title: CHAPTER_TITLES[3] as string, blocks };
}

// ---------------------------------------------------------------- 第 4 章

export function adviceTable(ctx: Ctx): TableBlock {
  const rows = [
    ['用神', ctx.yongshen.yong],
    ['喜神', ctx.yongshen.xi1],
  ].map(([label, w]) => {
    const a = ADVICE[w as WuXing];
    return [
      `${label as string}：${w as string}`,
      a.color,
      a.direction,
      a.numbers,
      a.industries,
      a.season,
    ];
  });
  return {
    type: 'table',
    kind: 'advice',
    columns: ['五行', '颜色', '方位', '数字（可选）', '可以优先考虑的行业方向', '季节'],
    rows,
  };
}

export function chapter4(b: ReportBuilder): Chapter {
  b.startChapter();
  const { ctx } = b.input;
  const blocks: Block[] = [adviceTable(ctx)];
  if (ctx.profile.confidence === '低')
    blocks.push({ type: 'notice', kind: 'advice_premise', text: ADVICE_PREMISE });
  blocks.push(...b.slot('CH4-WHY', 1));
  blocks.push(...b.slot('CH4-ELEMENT', 1, { element: ctx.yongshen.yong, role: '用' }));
  blocks.push(...b.slot('CH4-ELEMENT', 1, { element: ctx.yongshen.xi1, role: '喜' }));
  blocks.push(...b.slot('CH4-NOTE', 1));
  return { id: 4, title: CHAPTER_TITLES[4] as string, blocks };
}

/** 第 0–4 章（T31）；第 5–8 章见 T32 */
export function assembleChapters0to4(input: AssembleInput): {
  chapters: Chapter[];
  builder: ReportBuilder;
} {
  const b = new ReportBuilder(input);
  const chapters = [chapter0(b), chapter1(b), chapter2(b), chapter3(b), chapter4(b)];
  return { chapters, builder: b };
}
