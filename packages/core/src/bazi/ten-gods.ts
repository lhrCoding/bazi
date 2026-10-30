/**
 * 藏干与十神（ARCHITECTURE §3.3：「藏干比例、十神 —— 我们（strength.md S-HIDE 表 + 阴阳规则）」）。
 *
 * - 地支藏干与比例取自 rules/strength.md §1.2（S-HIDE）。计分（规则引擎）与展示（命盘表）用同一张表，
 *   避免口径不一；T14 会解析 strength.md 中的 JSON 参数块与本表逐项比对，防止手抄漂移。
 * - 列表第一个是本气，之后中气、余气（比例递减）。
 * - 十神：以日干为「我」，按五行生克（strength.md §1.3）+ 阴阳（report-sections.md §2：与日干同阴阳为偏、
 *   异阴阳为正）细分：
 *     同五行：比肩（同）/ 劫财（异）；我生：食神 / 伤官；我克：偏财 / 正财；克我：七杀 / 正官；生我：偏印 / 正印。
 * - 四柱天干中，日干本身记为「日主」；藏干一律按上述关系取十神（藏干与日干相同即比肩）。
 */
import { TIAN_GAN, type Gan, type Zhi } from './ganzhi';

export type WuXingName = '木' | '火' | '土' | '金' | '水';

export const TEN_GOD_NAMES = [
  '比肩',
  '劫财',
  '食神',
  '伤官',
  '偏财',
  '正财',
  '七杀',
  '正官',
  '偏印',
  '正印',
] as const;
export type TenGod = (typeof TEN_GOD_NAMES)[number];

/** 四柱天干十神：日干为「日主」。 */
export type StemTenGod = TenGod | '日主';

/** S-HIDE：地支 → [藏干, 比例]（本气在前；各支合计 1.0）。 */
export const HIDDEN_STEMS: Readonly<Record<Zhi, readonly (readonly [Gan, number])[]>> = {
  子: [['癸', 1.0]],
  丑: [
    ['己', 0.6],
    ['癸', 0.3],
    ['辛', 0.1],
  ],
  寅: [
    ['甲', 0.6],
    ['丙', 0.3],
    ['戊', 0.1],
  ],
  卯: [['乙', 1.0]],
  辰: [
    ['戊', 0.6],
    ['乙', 0.3],
    ['癸', 0.1],
  ],
  巳: [
    ['丙', 0.6],
    ['庚', 0.3],
    ['戊', 0.1],
  ],
  午: [
    ['丁', 0.7],
    ['己', 0.3],
  ],
  未: [
    ['己', 0.6],
    ['丁', 0.3],
    ['乙', 0.1],
  ],
  申: [
    ['庚', 0.6],
    ['壬', 0.3],
    ['戊', 0.1],
  ],
  酉: [['辛', 1.0]],
  戌: [
    ['戊', 0.6],
    ['辛', 0.3],
    ['丁', 0.1],
  ],
  亥: [
    ['壬', 0.7],
    ['甲', 0.3],
  ],
};

const WUXING_ORDER: readonly WuXingName[] = ['木', '火', '土', '金', '水'];

/** 天干五行：甲乙木、丙丁火、戊己土、庚辛金、壬癸水。 */
export function ganWuXing(g: Gan): WuXingName {
  return WUXING_ORDER[Math.floor(TIAN_GAN.indexOf(g) / 2)] as WuXingName;
}

/**
 * 十神：target 相对日干 dayGan。
 * 五行序号差 d = (target − 我) mod 5：0 同我、1 我生、2 我克、3 克我、4 生我（木→火→土→金→水 相生，隔一位相克）。
 */
export function tenGodOf(dayGan: Gan, target: Gan): TenGod {
  const di = TIAN_GAN.indexOf(dayGan);
  const ti = TIAN_GAN.indexOf(target);
  const d = (((Math.floor(ti / 2) - Math.floor(di / 2)) % 5) + 5) % 5;
  const samePolarity = di % 2 === ti % 2;
  return TEN_GOD_NAMES[d * 2 + (samePolarity ? 0 : 1)] as TenGod;
}
