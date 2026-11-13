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
import { godGroupOf } from '../rules/strength-power';
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
  /** 选中的变体序号（从 0 开始）；代码模板段为 null */
  variant: number | null;
  text: string;
  /** 「依据：」之后的文字；null = 不追加 */
  basis: string | null;
  /** 可送润色：槽位润色 = 可 且条目 polish_allowed ≠ false；代码模板段为 false（report-sections.md §9） */
  polishable: boolean;
  quote?: { text: string; source: string };
}
export interface NoticeBlock {
  type: 'notice';
  kind:
    | 'tst'
    | 'nohour'
    | 'rules_version'
    | 'shensha_note'
    | 'alt_possibility'
    | 'advice_premise'
    | 'method'
    | 'limitation'
    | 'disclaimer';
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
  /** power：图1 五行力量；dayun：图2 大运时间轴；liunian：图3 流年趋势线 */
  kind: 'power' | 'dayun' | 'liunian';
  data: Record<string, unknown>[];
  /** 固定图注（图一：UI.md §8，解释图中占比与正文百分比两套口径） */
  caption?: string;
}
export type Block = ParaBlock | NoticeBlock | TableBlock | ChartBlock | YearCard;

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
  /** 可选观察钩子：每次选段前回调槽位与求值上下文（T35 动态抽样检查 asserts 缺陷用；不影响拼装结果） */
  onSlot?: (slot: string, evalCtx: Readonly<Record<string, unknown>>) => void;
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
    this.input.onSlot?.(slotId, item === undefined ? this.evalCtx : { ...this.evalCtx, item });
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
      variant: chosen.variantIndex,
      polishable: (slotDef(slotId)?.polish ?? false) && e.polish_allowed !== false,
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
      variant: null,
      polishable: false,
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

/** 十神组 → 读者名（report-sections.md §0） */
const GOD_READER: Readonly<Record<string, string>> = {
  比劫: '比劫',
  印: '印星',
  食伤: '食伤',
  财: '财星',
  官杀: '官杀',
};

/** 图一每行：五行、占比（含日主）、十神组读者名、喜忌角色、是否日主所在五行（UI.md §8 图一） */
export function powerChartData(analysis: Analysis): Record<string, unknown>[] {
  const dm = analysis.strength.day_master.element;
  const ys = analysis.yongshen;
  const roleOf = (w: WuXing): '用' | '喜' | '忌' | '闲' =>
    w === ys.yong ? '用' : ys.xi.includes(w) ? '喜' : ys.ji.includes(w) ? '忌' : '闲';
  return (['木', '火', '土', '金', '水'] as const).map((w) => ({
    element: w,
    // 报告中的百分比一律取整（report-sections.md §0）
    pct: Math.round(analysis.strength.power_display_pct[w]),
    god: GOD_READER[godGroupOf(dm, w)] as string,
    role: roleOf(w),
    day: w === dm,
  }));
}

export function powerCaption(ctx: Ctx): string {
  return (
    `红框为日主所在五行。图中占比包含日主本身；正文中的百分比不含日主，所以比劫在正文中为 ${ctx.gods.比劫_pct}%。` +
    `同党（帮扶你的力量）占 ${ctx.strength.S_pct}%，异党（消耗你的力量）占 ${ctx.strength.yidang_pct}%。`
  );
}

export function chapter1(b: ReportBuilder): Chapter {
  b.startChapter();
  const { analysis, ctx } = b.input;
  const blocks: Block[] = [...b.slot('CH1-DAYMASTER', 1), ...b.slot('CH1-MONTH', 1)];
  blocks.push({
    type: 'chart',
    kind: 'power',
    data: powerChartData(analysis),
    caption: powerCaption(ctx),
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

// ---------------------------------------------------------------- 第 5–8 章（T32）

export interface YearCard {
  type: 'yearCard';
  year: number;
  ganzhi: string;
  /** 当年立春时刻（北京标准时间） */
  lichun: string;
  ten_god: string;
  tier: string;
  score: number;
  relations: { type: string; a: string; b: string }[];
  /** 所在大运干支（起运前为 null） */
  dayun: string | null;
  /** 换运当年 / 当前大运最后一年的标注（UI.md §7.4） */
  dayun_mark: '新一步第一年' | '最后一年' | null;
  /** 卡片依据行：流年天干十神；冲合；评分与档位（原始分数只出现在这里） */
  basis: string;
  head: ParaBlock[];
  domains: { career: ParaBlock[]; wealth: ParaBlock[]; love: ParaBlock[]; health: ParaBlock[] };
  do: ParaBlock[];
  watch: ParaBlock[];
  rel: ParaBlock[];
}

/** 换运年在参考年起 3 年内（含）才写过渡段 */
export const TRANSITION_WINDOW_YEARS = 3;

export function chapter5(b: ReportBuilder): Chapter {
  b.startChapter();
  const { ctx, chart } = b.input;
  const refYear = new Date(chart.refDate + 8 * 3600 * 1000).getUTCFullYear();
  const blocks: Block[] = [...b.slot('CH5-INTRO', 1)];
  blocks.push({
    type: 'chart',
    kind: 'dayun',
    data: ctx.dayun.map((d, i) => ({
      ganzhi: d.ganzhi,
      start_year: d.start_year,
      end_year: d.end_year,
      start_age: chart.dayun.steps[i]?.startAge ?? null,
      ten_god: d.stem_ten_god,
      score: d.score,
      tier: d.tier,
      phase: d.phase,
    })),
  });
  blocks.push(...b.slot('CH5-PAST', 1));
  const focus = ctx.dayun.filter((d) => d.phase === 'current' || d.phase === 'next');
  for (const d of focus)
    blocks.push(...b.slot('CH5-STEP', 1, d as unknown as Record<string, unknown>));
  let rel = 0;
  for (const d of focus) {
    if (rel >= 2) break;
    const keep = d.relations.filter((r) => r.b === '日支' || r.b === '月支');
    if (keep.length === 0) continue;
    const item = { ...d, relations: keep } as unknown as Record<string, unknown>;
    const ps = b.slot('CH5-REL', 1, item);
    rel += ps.length;
    blocks.push(...ps);
  }
  const next = ctx.dayun.find((d) => d.phase === 'next');
  if (next && next.start_year >= refYear && next.start_year <= refYear + TRANSITION_WINDOW_YEARS) {
    blocks.push(...b.slot('CH5-TRANSITION', 1, { year: next.start_year, ganzhi: next.ganzhi }));
  }
  blocks.push(...b.slot('CH5-FAR', 1));
  return { id: 5, title: CHAPTER_TITLES[5] as string, blocks };
}

const BRANCH_KEY: Readonly<Record<string, 'year' | 'month' | 'day' | 'hour'>> = {
  年支: 'year',
  月支: 'month',
  日支: 'day',
  时支: 'hour',
};

/** 逐年卡片依据行，如「流年天干戊为比肩；申冲寅（日支）；评分 −0.23，落在「平稳」区间」 */
export function yearCardBasis(
  l: {
    ganzhi: string;
    stem_ten_god: string;
    score: number;
    tier: string;
    relations: readonly { type: string; a: string; b: string }[];
  },
  chart: Chart,
): string {
  const ch = (label: string): string => {
    if (label === '流年支') return l.ganzhi[1] ?? '';
    if (label === '流年干') return l.ganzhi[0] ?? '';
    const k = BRANCH_KEY[label];
    return k ? (chart.pillars[k]?.[1] ?? label) : label;
  };
  const rels = l.relations.map((r) => `${ch(r.a)}${r.type}${ch(r.b)}（${r.b}）`);
  const sc = `${l.score < 0 ? '−' : '+'}${Math.abs(l.score).toFixed(2)}`;
  return [
    `流年天干${l.ganzhi[0] ?? ''}为${l.stem_ten_god}`,
    ...(rels.length > 0 ? [rels.join('、')] : []),
    `评分 ${sc}，落在「${l.tier}」区间`,
  ].join('；');
}

export function chapter6(b: ReportBuilder): Chapter {
  b.startChapter();
  const { ctx, chart } = b.input;
  const cards: YearCard[] = ctx.liunian.map((l, i) => {
    const item = l as unknown as Record<string, unknown>;
    return {
      type: 'yearCard',
      year: l.year,
      ganzhi: l.ganzhi,
      lichun: chart.liunian[i]?.lichun ?? '',
      ten_god: l.stem_ten_god,
      tier: l.tier,
      score: l.score,
      relations: l.relations,
      dayun: l.dayun,
      dayun_mark: ctx.dayun.some((d) => d.start_year === l.year)
        ? '新一步第一年'
        : ctx.dayun.some((d) => d.ganzhi === l.dayun && d.end_year === l.year)
          ? '最后一年'
          : null,
      basis: yearCardBasis(l, chart),
      head: b.slot('CH6-HEAD', 1, item),
      domains: {
        career: b.slot('CH6-CAREER', 1, item),
        wealth: b.slot('CH6-WEALTH', 1, item),
        love: b.slot('CH6-LOVE', 1, item),
        health: b.slot('CH6-HEALTH', 1, item),
      },
      do: b.slot('CH6-DO', 1, item),
      watch: b.slot('CH6-WATCH', 1, item),
      rel: l.relations.length > 0 ? b.slot('CH6-REL', 2, item) : [],
    };
  });
  const trend: ChartBlock = {
    type: 'chart',
    kind: 'liunian',
    data: ctx.liunian.map((l) => ({
      year: l.year,
      ganzhi: l.ganzhi,
      score: l.score,
      tier: l.tier,
    })),
  };
  return {
    id: 6,
    title: CHAPTER_TITLES[6] as string,
    blocks: [trend, ...cards],
  };
}

/** 占比 > 40% 或 < 5% 的五行（CH7-HEALTH 维度） */
export function healthExtremes(ctx: Ctx): { element: WuXing; state: '过旺' | '过弱' }[] {
  return (['木', '火', '土', '金', '水'] as const)
    .filter((w) => ctx.power_pct[w] > 40 || ctx.power_pct[w] < 5)
    .map((w) => ({ element: w, state: ctx.power_pct[w] > 40 ? '过旺' : '过弱' }));
}

export function chapter7(b: ReportBuilder): Chapter {
  b.startChapter();
  const { ctx } = b.input;
  const cur = ctx.dayun.find((d) => d.phase === 'current');
  const blocks: Block[] = [...b.slot('CH7-CAREER', 1)];
  if (cur) blocks.push(...b.slot('CH7-CAREER-NOW', 1, cur as unknown as Record<string, unknown>));
  blocks.push(...b.slot('CH7-WEALTH', 1), ...b.slot('CH7-LOVE', 1));
  if (ctx.liunian.some((l) => l.relations.some((r) => r.b === '日支')))
    blocks.push(...b.slot('CH7-LOVE-YEARS', 1));
  const ex = healthExtremes(ctx);
  blocks.push(...b.slot('CH7-HEALTH', Math.max(1, Math.min(2, ex.length)), undefined, ex[0]));
  blocks.push(...b.slot('CH7-HEALTH-END', 1));
  return { id: 7, title: CHAPTER_TITLES[7] as string, blocks };
}

/** 第 8 章免责声明（代码常量，待用户审定后可移入 ch08_fixed.yaml） */
export const DISCLAIMER =
  '本报告是传统命理文化的参考与娱乐内容，不构成医疗、投资、法律或其他任何专业建议；重要决定请以现实情况和专业意见为准。';

export function chapter8(
  b: ReportBuilder,
  opts: { limitations: readonly string[]; textsVersion: string },
): Chapter {
  const { chart } = b.input;
  const tst =
    chart.tst_status === '已校正'
      ? '本份报告已按你选择的出生地做了真太阳时校正。'
      : chart.hourKnown
        ? '本份报告未做真太阳时校正（未选择出生地），时辰按北京时间排定。'
        : '未提供出生时辰，本份报告按三柱分析，不涉及真太阳时校正。';
  const lines: NoticeBlock[] = [
    {
      type: 'notice',
      kind: 'rules_version',
      text: `规则版本 ${RULES_VERSION}；素材库版本 ${opts.textsVersion}。`,
    },
    {
      type: 'notice',
      kind: 'method',
      text: '子时口径：采用早晚子时派，23:00–23:59 出生日柱仍按当天、时干按次日日干起。',
    },
    { type: 'notice', kind: 'method', text: tst },
    { type: 'notice', kind: 'shensha_note', text: SHENSHA_FOOTNOTE },
    ...opts.limitations.map((l): NoticeBlock => ({
      type: 'notice',
      kind: 'rules_version',
      text: `已知局限：${l}`,
    })),
    { type: 'notice', kind: 'rules_version', text: DISCLAIMER },
  ];
  return { id: 8, title: CHAPTER_TITLES[8] as string, blocks: lines };
}

export interface Report {
  meta: {
    textsVersion: string;
    rulesVersion: string;
    engineVersion: string;
    tstStatus: string;
    refDate: number;
  };
  chapters: Chapter[];
  events: ReportEvent[];
}

/**
 * 公开 API：拼装完整报告（第 0–8 章）。
 * @param limitations strength.md §8「已知局限」各条（调用方从 rules/ 读出后传入；core 不做 IO）
 */
export function assembleReport(
  input: AssembleInput & { textsVersion: string; limitations: readonly string[] },
): Report {
  const b = new ReportBuilder(input);
  const chapters = [
    chapter0(b),
    chapter1(b),
    chapter2(b),
    chapter3(b),
    chapter4(b),
    chapter5(b),
    chapter6(b),
    chapter7(b),
    chapter8(b, input),
  ];
  return {
    meta: {
      textsVersion: input.textsVersion,
      rulesVersion: RULES_VERSION,
      engineVersion: input.chart.engineVersion,
      tstStatus: input.chart.tst_status,
      refDate: input.chart.refDate,
    },
    chapters,
    events: b.events,
  };
}

/** 从 strength.md §8 取「已知局限」各条（去掉编号；第 4 条是给维护者的说明，不写进报告） */
export function limitationsFromStrengthMd(md: string): string[] {
  const sec = md.slice(md.indexOf('## 8. 已知局限'));
  const end = sec.indexOf('\n## ', 3);
  return (end > 0 ? sec.slice(0, end) : sec)
    .split('\n')
    .map((l) => /^\d+a?\. (.+)$/.exec(l.trim())?.[1])
    .filter((x): x is string => x !== undefined && !x.startsWith('以上参数可以改'));
}
