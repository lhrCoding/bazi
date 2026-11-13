/**
 * R-CHECK 成品检查（TASKS T33；rules/report-sections.md §2、§7，ARCHITECTURE §4.3.7）。
 *
 * 对拼装好的报告做回归保险，返回检查结果，不抛错：生产环境不通过 → 报告照常返回，调用方记 rcheck_failed{rule, slot}
 * 告警日志（用户 2026-10-29 确认告警放行）；测试环境用 assertRCheck 让测试失败。
 *
 * 检查对象「正文」= 素材段落与年度卡片中的段落（代码模板的提示句不含：如「另一种可能」句会写交节另一组年月柱，
 * 那不是本命盘的干支）。禁用词对全部文字（含提示、表格）检查。
 *
 * - YEAR_GANZHI：正文中的「dddd年」与干支字面 ⊆ ctx 中出现过的年份 / 干支（四柱、大运、流年）。
 * - WUXING：「有利 / 喜 / 喜神 / 用神 + 五行」不得是忌神；「忌 / 忌神 / 节制 + 五行」不得是用喜（关键词后 4 字内的五行，
 *   含「、」连接的后续五行；关键词与五行之间不能隔着「、」——「土为喜、金宜节制」里的金不属于「喜」；前面是「不 / 非」时不算）。
 * - LENGTH：第 1–7 章各章与全文字数（§2；三柱第 3 章下限 550、全文下限 4,800）。字数 = 正文非空白字符数（含术语加注）。
 * - BASIS：第 1–3、7 章每段都有依据（依据模板为「—」或无的槽位除外）；第 6 章每张卡有十神与档位。
 * - WORDS：禁用词 / 疾病名词 / 金融产品词 / 吉神禁用表述（shensha.md §4，SS-WORDING）（白名单豁免）。
 * - SIMILARITY：任两段正文 4-gram Jaccard ≤ 0.5（跨年同条目同变体的重复会在此报警，见 texts/README.md §5.2）。
 */
import type { Wordlists } from '../texts/lint';
import { grams4, jaccardSets } from '../texts/lint';
import type { Block, ParaBlock, Report, YearCard } from './assemble';
import type { Ctx } from './ctx';
import { slotDef } from './slots';

export type RCheckRule = 'YEAR_GANZHI' | 'WUXING' | 'LENGTH' | 'BASIS' | 'WORDS' | 'SIMILARITY';

export interface RCheckFailure {
  rule: RCheckRule;
  chapter: number | null;
  slot: string | null;
  message: string;
}

export interface RCheckResult {
  passed: boolean;
  failures: RCheckFailure[];
}

/** report-sections.md §2 各章目标字数 */
export const CHAPTER_LENGTH: Readonly<Record<number, readonly [number, number]>> = {
  1: [500, 750],
  2: [450, 900],
  3: [650, 950],
  4: [350, 650],
  5: [750, 1300],
  6: [1550, 2200],
  7: [800, 1300],
};
export const NOHOUR_CH3_MIN = 550;
export const TOTAL_LENGTH: readonly [number, number] = [5000, 8000];
export const NOHOUR_TOTAL_MIN = 4800;
export const SIMILARITY_MAX = 0.5;
/**
 * shensha.md §4 吉神措辞禁用表述中，report-sections.md §7 禁用词表尚未收录的部分（SS-WORDING；
 * 逢凶化吉、贵人年、双贵人、贵人多、佩戴、摆放、开运、化解 等已在 §7 表中）。对全部文字检查。
 */
export const SHENSHA_FORBIDDEN: readonly string[] = [
  '必有贵人',
  '一定顺利',
  '保平安',
  '贵人到',
  '格外有力',
  '比一般人多',
];
/** 依据必需的章 */
export const BASIS_CHAPTERS: readonly number[] = [1, 2, 3, 7];

const GANZHI_RE = /[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g;
const YEAR_RE = /(\d{4})年/g;
const FAV_RE =
  /(?<![不非])(有利|喜神|喜|用神)[^，。；！？、\n]{0,4}?([木火土金水](?:、[木火土金水])*)/g;
const UNFAV_RE =
  /(?<![不非])(忌神|忌|节制)[^，。；！？、\n]{0,4}?([木火土金水](?:、[木火土金水])*)/g;

function cardParas(c: YearCard): ParaBlock[] {
  return [
    ...c.head,
    ...c.domains.career,
    ...c.domains.wealth,
    ...c.domains.love,
    ...c.domains.health,
    ...c.do,
    ...c.watch,
    ...c.rel,
  ];
}

/** 一章中的全部正文段落（含卡片内段落） */
export function chapterParas(blocks: readonly Block[]): ParaBlock[] {
  return blocks.flatMap((b) =>
    b.type === 'para' ? [b] : b.type === 'yearCard' ? cardParas(b) : [],
  );
}

export function textLength(s: string): number {
  return [...s.replace(/\s/g, '')].length;
}

function allTexts(b: Block): string[] {
  switch (b.type) {
    case 'para':
      return [b.text, ...(b.basis ? [b.basis] : []), ...(b.quote ? [b.quote.text] : [])];
    case 'notice':
      return [b.text];
    case 'table':
      return [...b.columns, ...b.rows.flat()];
    case 'chart':
      return [];
    case 'yearCard':
      return cardParas(b).flatMap(allTexts);
  }
}

export function rcheck(report: Report, ctx: Ctx, words: Wordlists): RCheckResult {
  const failures: RCheckFailure[] = [];
  const fail = (
    rule: RCheckRule,
    chapter: number | null,
    slot: string | null,
    message: string,
  ): void => {
    failures.push({ rule, chapter, slot, message });
  };
  const years = new Set<number>([
    ...ctx.dayun.flatMap((d) => [d.start_year, d.end_year]),
    ...ctx.liunian.map((l) => l.year),
  ]);
  const ganzhi = new Set<string>([
    ...Object.values(ctx.pillars).filter((x): x is NonNullable<typeof x> => x !== null),
    ...ctx.dayun.map((d) => d.ganzhi),
    ...ctx.liunian.map((l) => l.ganzhi),
  ]);
  const favorable = new Set<string>(ctx.yongshen.favorable);
  const ji = new Set<string>(ctx.yongshen.ji);
  const hourKnown = ctx.profile.time_known;

  const body: { chapter: number; p: ParaBlock }[] = [];
  let total = 0;
  for (const ch of report.chapters) {
    const paras = chapterParas(ch.blocks);
    for (const p of paras) body.push({ chapter: ch.id, p });

    // LENGTH
    const range = CHAPTER_LENGTH[ch.id];
    if (range) {
      const n = paras.reduce((s, p) => s + textLength(p.text), 0);
      total += n;
      const lo = ch.id === 3 && !hourKnown ? NOHOUR_CH3_MIN : range[0];
      if (n < lo || n > range[1])
        fail('LENGTH', ch.id, null, `第 ${ch.id} 章 ${n} 字，不在 [${lo}, ${range[1]}]`);
    }

    // BASIS
    if (BASIS_CHAPTERS.includes(ch.id)) {
      for (const p of paras) {
        const tpl = slotDef(p.slot)?.basis;
        const needs = tpl !== null && tpl !== undefined && tpl !== '—';
        if (needs && !p.basis) fail('BASIS', ch.id, p.slot, `${p.slot} 段落缺少依据`);
      }
    }
    if (ch.id === 6) {
      for (const b of ch.blocks) {
        if (b.type === 'yearCard' && (!b.ten_god || !b.tier))
          fail('BASIS', 6, 'CH6-HEAD', `${b.year} 年卡片缺少十神或档位`);
      }
    }

    // WORDS（全部文字）
    for (const b of ch.blocks) {
      for (const raw of allTexts(b)) {
        let t = raw;
        for (const w of words.whitelist) t = t.split(w).join('□'.repeat(w.length));
        for (const [kind, list] of [
          ['禁用词', words.forbidden],
          ['吉神禁用表述', SHENSHA_FORBIDDEN],
          ['疾病名词', words.disease],
          ['金融产品词', words.finance],
        ] as const) {
          for (const w of list) {
            if (w && t.includes(w))
              fail('WORDS', ch.id, b.type === 'para' ? b.slot : null, `命中${kind}「${w}」`);
          }
        }
      }
    }
  }
  const totalLo = hourKnown ? TOTAL_LENGTH[0] : NOHOUR_TOTAL_MIN;
  if (total < totalLo || total > TOTAL_LENGTH[1]) {
    fail('LENGTH', null, null, `全文 ${total} 字，不在 [${totalLo}, ${TOTAL_LENGTH[1]}]`);
  }

  for (const { chapter, p } of body) {
    // YEAR_GANZHI
    for (const m of p.text.matchAll(YEAR_RE)) {
      if (!years.has(Number(m[1])))
        fail('YEAR_GANZHI', chapter, p.slot, `年份「${m[0]}」不在本命盘的大运 / 流年中`);
    }
    for (const m of p.text.matchAll(GANZHI_RE)) {
      if (!ganzhi.has(m[0]))
        fail('YEAR_GANZHI', chapter, p.slot, `干支「${m[0]}」不在本命盘的四柱 / 大运 / 流年中`);
    }
    // WUXING
    for (const m of p.text.matchAll(FAV_RE)) {
      for (const e of (m[2] as string).split('、')) {
        if (ji.has(e)) fail('WUXING', chapter, p.slot, `「${m[0]}」把忌神${e}写成有利`);
      }
    }
    for (const m of p.text.matchAll(UNFAV_RE)) {
      for (const e of (m[2] as string).split('、')) {
        if (favorable.has(e)) fail('WUXING', chapter, p.slot, `「${m[0]}」把用喜${e}写成需节制`);
      }
    }
  }

  // SIMILARITY
  const grams = body.map(({ p }) => grams4(p.text));
  for (let i = 0; i < body.length; i++) {
    for (let j = i + 1; j < body.length; j++) {
      const a = body[i] as { chapter: number; p: ParaBlock };
      const c = body[j] as { chapter: number; p: ParaBlock };
      const s = jaccardSets(grams[i] as Set<string>, grams[j] as Set<string>);
      if (s > SIMILARITY_MAX) {
        fail(
          'SIMILARITY',
          c.chapter,
          c.p.slot,
          `${c.p.slot}（${c.p.entry}）与 ${a.p.slot}（${a.p.entry}）相似度 ${s.toFixed(2)} > ${SIMILARITY_MAX}`,
        );
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

/** 测试环境：不通过即抛错（列出全部问题） */
export function assertRCheck(r: RCheckResult): void {
  if (!r.passed) {
    throw new Error(
      `R-CHECK 不通过：\n  ${r.failures.map((f) => `[${f.rule}] ${f.slot ?? ''} ${f.message}`).join('\n  ')}`,
    );
  }
}
