/**
 * 规则编号全集（ARCHITECTURE §4.2「规则与代码对应」）。
 *
 * - 这里列出 rules/*.md 中出现的全部 `CAL- / S- / Y- / SS- / R-` 编号，按「定义文件」分组（编号前缀决定定义文件：
 *   CAL → calendar.md、S → strength.md、Y → yongshen.md、SS → shensha.md、R → report-sections.md），组内按文中首次出现的顺序。
 * - test/rules-registry.test.ts 扫描 rules/*.md，断言本列表与 md 中的编号集合**完全相等**（双向）：
 *   md 新增编号而代码未登记 → 失败；代码登记了 md 里没有的编号 → 失败。
 * - 每个编号的实现状态（已实现 / 待实现 / 仅文档）见 registry.ts。
 */
export const RULE_IDS = [
  // calendar.md
  'CAL-INPUT',
  'CAL-TZ',
  'CAL-YM',
  'CAL-TST',
  'CAL-DH',
  'CAL-YUN',
  'CAL-YM-1',
  'CAL-YM-2',
  'CAL-DH-ZI',
  'CAL-NOHOUR',
  // strength.md
  'S-HIDE',
  'S-POWER',
  'S-ROOT',
  'S-COMBO',
  'S-LEVEL',
  'S-CONG',
  'S-ZHUANWANG',
  'S-NOHOUR',
  // yongshen.md
  'Y-CONG',
  'Y-ZHUANWANG',
  'Y-FY',
  'Y-FY-W-SHA',
  'Y-FY-W-SHI',
  'Y-FY-W-CAI',
  'Y-FY-S-YIN',
  'Y-FY-S-BI-GUAN',
  'Y-FY-S-BI-SHI',
  'Y-SWAP',
  'Y-TH',
  'Y-TH-AGREE',
  'Y-TH-NEUTRAL-OVERRIDE',
  'Y-TH-ADD-XI',
  'Y-TG',
  // shensha.md
  'SS-SCOPE',
  'SS-TIANYI',
  'SS-TAIJI',
  'SS-WENCHANG',
  'SS-YUEDE',
  'SS-OUTPUT',
  'SS-DISPLAY',
  'SS-WORDING',
  // report-sections.md
  'R-CTX',
  'R-FREE',
  'R-SEC',
  'R-SLOT',
  'R-NOHOUR',
  'R-COVER',
  'R-PERSONA',
  'R-CHECK',
  'R-YUN-SCORE',
  'R-LN-SCORE',
  'R-POLISH',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export function isRuleId(s: string): s is RuleId {
  return (RULE_IDS as readonly string[]).includes(s);
}

/** 编号前缀 → 定义该编号的 rules/ 文件。 */
export const RULE_ID_PREFIX_FILES = {
  CAL: 'calendar.md',
  S: 'strength.md',
  Y: 'yongshen.md',
  SS: 'shensha.md',
  R: 'report-sections.md',
} as const;

export type RuleIdPrefix = keyof typeof RULE_ID_PREFIX_FILES;

export function ruleIdPrefix(id: string): RuleIdPrefix | null {
  const m = /^(CAL|SS|S|Y|R)-/.exec(id);
  return m ? (m[1] as RuleIdPrefix) : null;
}
