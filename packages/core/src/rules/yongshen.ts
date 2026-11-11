/**
 * 喜用神全链（TASKS T17；rules/yongshen.md v1.1）。
 *
 * 判定顺序固定（§0）：格局 → 扶抑 → 用神缺位互换 → 调候 → 通关 → 计算闲神。每一步只做 md 写明的改动：
 * - 格局（§2，Y-CONG / Y-ZHUANWANG）：strength.special 非空时整套喜忌换成「顺势」表，并**跳过**互换、调候、通关。
 * - 扶抑（§3.1 / §3.2，Y-FY-*）：偏弱找异党最强 D（并列 官杀 > 食伤 > 财），偏旺找同党较大者 F（比劫 ≥ 印 → 比劫）。
 * - 互换（§3.3，Y-SWAP）：扶抑用神原局力量 = 0 且第一喜神力量 ≥ 1.0 → 二者互换。
 * - 调候（§4，Y-TH-*）：亥子丑月需火、巳午未月需水；所需五行 power / total < 0.10 才触发。
 *   AGREE（已是用 / 喜）→ NEUTRAL-OVERRIDE（中和：调候做用神，原用神保留为第一喜神，「冬删水 / 夏删土」只作用于原喜神列表）
 *   → ADD-XI（身弱 / 身旺：追加到喜神末尾）。三种处理都从忌神中删去调候五行（AGREE 时它本不在忌神中）。
 * - 通关（§5，Y-TG）：power 最大两行相克且各 ≥ total × 25%，通关五行 = 攻方所生；方向一致、不在忌神、不是用神才追加，
 *   否则只写 notes。
 * - 闲神（§6）：五行全集 − 用 − 喜 − 忌，按 木火土金水 顺序。
 *
 * 神煞、纳音、空亡不参与任何一步（输入里没有这些字段）。三柱命盘按三柱 strength 走 §3–§6（§8），special 恒为 null。
 * 一律用未四舍五入的浮点比较，FP_EPS 只消除二进制表示误差（与 strength-level.ts 同口径）。
 */
import type { Zhi } from '../bazi/ganzhi';
import { ruleHit, type RuleHit } from './rule-hit';
import { elementOfGroup, godGroupOf, WUXING_ORDER } from './strength-power';
import type { Strength } from './strength-level';
import type { GodGroup, SpecialPattern, StrengthDirection, StrengthLevel, WuXing } from './types';

// ---------- 参数（yongshen.md 中的数值，rules-params.test.ts 比对） ----------

/** §3.2：官杀力量 ≥ 1.0 才用官杀制比劫。 */
export const FY_GUANSHA_MIN = 1.0;
/** §3.3：第一喜神力量 ≥ 1.0 才互换。 */
export const SWAP_XI_MIN = 1.0;
/** §4：所需五行 power / total < 0.10 触发调候。 */
export const TH_MAX_SHARE = 0.1;
/** §5：两强各自 ≥ total × 25%。 */
export const TG_MIN_SHARE = 0.25;

/** §4：月支 → 调候所需五行。春秋两季不做调候。 */
export const TIAOHOU_NEED: Readonly<Partial<Record<Zhi, WuXing>>> = {
  亥: '火',
  子: '火',
  丑: '火',
  巳: '水',
  午: '水',
  未: '水',
};

// ---------- 类型 ----------

export type FyRuleId =
  'Y-FY-W-SHA' | 'Y-FY-W-SHI' | 'Y-FY-W-CAI' | 'Y-FY-S-YIN' | 'Y-FY-S-BI-GUAN' | 'Y-FY-S-BI-SHI';

/** report-sections.md §0 / texts/README.md §3 `yongshen.fy_rule`：扶抑子规则，特殊格局时为 Y-CONG / Y-ZHUANWANG。 */
export type FyRule = FyRuleId | 'Y-CONG' | 'Y-ZHUANWANG';

export type TiaohouKind = 'AGREE' | 'NEUTRAL-OVERRIDE' | 'ADD-XI';

/** 十神分组层面的取法（§2 / §3 表格一行）。 */
export interface GroupPick {
  yong: GodGroup;
  xi: GodGroup[];
  ji: GodGroup[];
}

/** 通关检查结果（§5）；两强不相克或不足 25% 时为 null。 */
export interface TongguanCheck {
  /** power 最大的两个五行（并列按 木火土金水） */
  a: WuXing;
  b: WuXing;
  /** 攻方（克者）与受克方 */
  attacker: WuXing;
  target: WuXing;
  /** 通关五行 = 攻方所生 */
  element: WuXing;
  /** Z 的十神分组 */
  group: GodGroup;
  direction_ok: boolean;
  in_ji: boolean;
  is_yong: boolean;
  already_xi: boolean;
  adopted: boolean;
}

export interface Yongshen {
  yong: WuXing;
  xi: WuXing[];
  ji: WuXing[];
  xian: WuXing[];
  /** 格局 / 扶抑这一步的规则（report-sections.md 的 yongshen.fy_rule） */
  fy_rule: FyRule;
  /** 格局 / 扶抑这一步的结论（互换、调候、通关之前），供报告 METHOD 段「按扶抑这一步……」 */
  fy: { yong: WuXing; xi: WuXing[]; ji: WuXing[] };
  swap: boolean;
  swap_from: WuXing | null;
  swap_to: WuXing | null;
  th: TiaohouKind | null;
  /** 调候所需五行：仅在调候触发（th 非空）时给出 */
  th_element: WuXing | null;
  /** 调候五行原局占比（未取整）；未触发时为 null */
  th_share: number | null;
  /** NEUTRAL-OVERRIDE 时从原喜神列表删去的五行（冬水 / 夏土），否则 null */
  th_removed: WuXing | null;
  tg: boolean;
  tg_element: WuXing | null;
  tongguan: TongguanCheck | null;
  notes: string[];
  rules_hit: RuleHit[];
  /** 依据句（yongshen.md §6），由代码按模板拼出，变量只来自排盘数据 */
  basis: string[];
}

/** computeYongshen 需要的 strength 字段（三柱 / 四柱同口径）。 */
export type YongshenStrengthInput = Pick<
  Strength,
  'day_master' | 'power' | 'total' | 'gods' | 'S' | 'level' | 'special' | 'direction'
>;

// ---------- 小工具 ----------

const FP_EPS = 1e-9;
const gte = (a: number, b: number): boolean => a >= b - FP_EPS;
const lt = (a: number, b: number): boolean => !gte(a, b);
const gt = (a: number, b: number): boolean => a > b + FP_EPS;
const isZero = (a: number): boolean => Math.abs(a) < FP_EPS;
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const pct = (x: number): number => Math.round(x * 100);

/** a 克 b：相生序差 (b − a) mod 5 = 2。 */
export function wuxingKe(a: WuXing, b: WuXing): boolean {
  return (WUXING_ORDER.indexOf(b) - WUXING_ORDER.indexOf(a) + 5) % 5 === 2;
}

/** a 所生的五行。 */
export function wuxingSheng(a: WuXing): WuXing {
  return WUXING_ORDER[(WUXING_ORDER.indexOf(a) + 1) % 5] as WuXing;
}

/** 克 x 的五行。 */
function keOf(x: WuXing): WuXing {
  return WUXING_ORDER[(WUXING_ORDER.indexOf(x) + 3) % 5] as WuXing;
}

// ---------- §2 特殊格局 ----------

/** §2 表：special → 用 / 喜 / 忌（十神分组，按表中顺序）。 */
export const SPECIAL_PICKS: Readonly<Record<SpecialPattern, GroupPick>> = {
  从财: { yong: '财', xi: ['食伤'], ji: ['比劫', '印'] },
  从杀: { yong: '官杀', xi: ['财'], ji: ['印', '比劫', '食伤'] },
  从儿: { yong: '食伤', xi: ['财'], ji: ['印', '官杀'] },
  从势: { yong: '财', xi: ['食伤', '官杀'], ji: ['印', '比劫'] },
  专旺: { yong: '比劫', xi: ['印', '食伤'], ji: ['官杀', '财'] },
  从强: { yong: '印', xi: ['比劫'], ji: ['财', '食伤', '官杀'] },
};

function specialRule(special: SpecialPattern): 'Y-CONG' | 'Y-ZHUANWANG' {
  return special === '专旺' || special === '从强' ? 'Y-ZHUANWANG' : 'Y-CONG';
}

// ---------- §3 扶抑 ----------

/** §3.1 异党并列优先级：官杀 > 食伤 > 财。 */
export const WEAK_ALIEN_PRIORITY: readonly GodGroup[] = ['官杀', '食伤', '财'];

/** 按力量从大到小排异党三方，并列按 官杀 > 食伤 > 财（稳定排序）。 */
export function rankAliens(gods: Readonly<Record<GodGroup, number>>): GodGroup[] {
  return [...WEAK_ALIEN_PRIORITY].sort((x, y) => {
    if (gt(gods[x], gods[y])) return -1;
    if (gt(gods[y], gods[x])) return 1;
    return WEAK_ALIEN_PRIORITY.indexOf(x) - WEAK_ALIEN_PRIORITY.indexOf(y);
  });
}

const WEAK_TABLE: Readonly<Record<string, { rule: FyRuleId; yong: GodGroup; xi: GodGroup }>> = {
  官杀: { rule: 'Y-FY-W-SHA', yong: '印', xi: '比劫' },
  食伤: { rule: 'Y-FY-W-SHI', yong: '印', xi: '比劫' },
  财: { rule: 'Y-FY-W-CAI', yong: '比劫', xi: '印' },
};

export interface FuyiResult extends GroupPick {
  rule: FyRuleId;
  /** 偏弱：异党最强 D；偏旺：同党较大者 F */
  key: GodGroup;
}

/** §3.1 / §3.2：扶抑取法。direction 由 level 决定（身弱 / 中和偏弱 → 偏弱；身旺 / 中和偏旺 → 偏旺）。 */
export function fuyi(
  gods: Readonly<Record<GodGroup, number>>,
  direction: StrengthDirection,
): FuyiResult {
  if (direction === '偏弱') {
    const [d, second] = rankAliens(gods) as [GodGroup, GodGroup, GodGroup];
    const row = WEAK_TABLE[d] as (typeof WEAK_TABLE)[string];
    return { rule: row.rule, key: d, yong: row.yong, xi: [row.xi], ji: [d, second] };
  }
  if (!gte(gods['比劫'], gods['印'])) {
    return { rule: 'Y-FY-S-YIN', key: '印', yong: '财', xi: ['食伤'], ji: ['印', '比劫'] };
  }
  return gte(gods['官杀'], FY_GUANSHA_MIN)
    ? { rule: 'Y-FY-S-BI-GUAN', key: '比劫', yong: '官杀', xi: ['财'], ji: ['比劫', '印'] }
    : { rule: 'Y-FY-S-BI-SHI', key: '比劫', yong: '食伤', xi: ['财'], ji: ['比劫', '印'] };
}

// ---------- §5 通关 ----------

/** §5：取 power 最大两行（并列按 木火土金水），相克且各 ≥ 25% 时返回通关检查，否则 null。 */
export function tongguanPair(
  power: Readonly<Record<WuXing, number>>,
  total: number,
): Pick<TongguanCheck, 'a' | 'b' | 'attacker' | 'target' | 'element'> | null {
  const ranked = [...WUXING_ORDER].sort((x, y) => {
    if (gt(power[x], power[y])) return -1;
    if (gt(power[y], power[x])) return 1;
    return WUXING_ORDER.indexOf(x) - WUXING_ORDER.indexOf(y);
  });
  const [a, b] = ranked as [WuXing, WuXing];
  const min = total * TG_MIN_SHARE;
  if (!gte(power[a], min) || !gte(power[b], min)) return null;
  let attacker: WuXing;
  let target: WuXing;
  if (wuxingKe(a, b)) [attacker, target] = [a, b];
  else if (wuxingKe(b, a)) [attacker, target] = [b, a];
  else return null;
  return { a, b, attacker, target, element: wuxingSheng(attacker) };
}

const TG_GROUPS: Readonly<Record<StrengthDirection, readonly GodGroup[]>> = {
  偏弱: ['印', '比劫'],
  偏旺: ['食伤', '财', '官杀'],
};

// ---------- 依据句模板 ----------

const SEASON_WORD: Readonly<Record<WuXing, string>> = {
  火: '严寒',
  水: '炎热',
  木: '',
  土: '',
  金: '',
};
/** NEUTRAL-OVERRIDE 从原喜神列表删去的五行（冬水 / 夏土）的说明。 */
const REMOVED_REASON: Readonly<Partial<Record<WuXing, string>>> = {
  水: '为寒气来源',
  土: '燥而克水',
};

const FY_REASON: Readonly<Record<FyRuleId, string>> = {
  'Y-FY-W-SHA': '杀重用印化杀',
  'Y-FY-W-SHI': '食伤泄重用印制之',
  'Y-FY-W-CAI': '财多身弱',
  'Y-FY-S-YIN': '印旺用财破印',
  'Y-FY-S-BI-GUAN': '比劫重用官杀制之',
  'Y-FY-S-BI-SHI': '无官杀则用食伤泄秀',
};

const groupEl = (g: GodGroup, el: WuXing): string => `${g}${el}`;

// ---------- 主流程 ----------

/**
 * 由旺衰结果与月支计算喜用神（yongshen.md §0–§6）。
 * @param st strength 计算结果（四柱或三柱）
 * @param monthZhi 月支（调候用）
 */
export function computeYongshen(st: YongshenStrengthInput, monthZhi: Zhi): Yongshen {
  const dm = st.day_master.element;
  const el = (g: GodGroup): WuXing => elementOfGroup(dm, g);
  const els = (gs: readonly GodGroup[]): WuXing[] => gs.map(el);
  const share = (e: WuXing): number => st.power[e] / st.total;
  const head = `${st.day_master.stem}${dm}生于${monthZhi}月，同党占 ${pct(st.S)}%`;

  const rulesHit: RuleHit[] = [];
  const notes: string[] = [];
  const basis: string[] = [];

  // ① 格局
  if (st.special !== null) {
    const pick = SPECIAL_PICKS[st.special];
    const rule = specialRule(st.special);
    const yong = el(pick.yong);
    const xi = els(pick.xi);
    const ji = els(pick.ji);
    rulesHit.push(
      ruleHit(rule, st.special, {
        special: st.special,
        yong: pick.yong,
        xi: [...pick.xi],
        ji: [...pick.ji],
      }),
    );
    basis.push(
      `${head}，${st.special}格成立，顺势取${groupEl(pick.yong, yong)}为用神，` +
        `${pick.xi.map((g) => groupEl(g, el(g))).join('、')}为喜神；` +
        `${pick.ji.map((g) => groupEl(g, el(g))).join('、')}逆其势，为忌神（特殊格局不做调候、通关修正）。`,
    );
    return finish({
      yong,
      xi,
      ji,
      fy_rule: rule,
      fy: { yong, xi: [...xi], ji: [...ji] },
      swap: false,
      swap_from: null,
      swap_to: null,
      th: null,
      th_element: null,
      th_share: null,
      th_removed: null,
      tg: false,
      tg_element: null,
      tongguan: null,
      notes,
      rules_hit: rulesHit,
      basis,
    });
  }

  const direction = st.direction;
  const level: StrengthLevel = st.level;

  // ② 扶抑
  const f = fuyi(st.gods, direction);
  let yong = el(f.yong);
  let xi = els(f.xi);
  let ji = els(f.ji);
  const fy = { yong, xi: [...xi], ji: [...ji] };
  rulesHit.push(
    ruleHit(f.rule, '', {
      level,
      direction,
      key: f.key,
      gods: Object.fromEntries(Object.entries(st.gods).map(([k, v]) => [k, r4(v)])),
      yong: f.yong,
      xi: [...f.xi],
      ji: [...f.ji],
    }),
  );
  basis.push(
    direction === '偏弱'
      ? `${head}，属${level}；异党中${f.key}最重，按扶抑取${groupEl(f.yong, yong)}为用神、` +
          `${groupEl(f.xi[0] as GodGroup, xi[0] as WuXing)}为喜神（${FY_REASON[f.rule]}）。`
      : `${head}，属${level}；同党以${f.key}为主，按扶抑取${groupEl(f.yong, yong)}为用神、` +
          `${groupEl(f.xi[0] as GodGroup, xi[0] as WuXing)}为喜神（${FY_REASON[f.rule]}）。`,
  );

  // ③ 用神缺位互换
  let swap = false;
  let swapFrom: WuXing | null = null;
  let swapTo: WuXing | null = null;
  const xi1 = xi[0] as WuXing;
  if (isZero(st.power[yong]) && gte(st.power[xi1], SWAP_XI_MIN)) {
    swap = true;
    swapFrom = yong;
    swapTo = xi1;
    xi = [yong, ...xi.slice(1)];
    yong = xi1;
    rulesHit.push(
      ruleHit('Y-SWAP', '用神原局不现，与第一喜神互换', {
        from: swapFrom,
        to: swapTo,
        from_power: r4(st.power[swapFrom]),
        to_power: r4(st.power[swapTo]),
        min: SWAP_XI_MIN,
      }),
    );
    basis.push(
      `${swapFrom}在原局中完全不见，而${swapTo}有 ${st.power[swapTo].toFixed(2)}，` +
        `用神改为${swapTo}，${swapFrom}降为第一喜神；喜忌方向不变。`,
    );
  }

  // ④ 调候
  let th: TiaohouKind | null = null;
  let thElement: WuXing | null = null;
  let thShare: number | null = null;
  let thRemoved: WuXing | null = null;
  const need = TIAOHOU_NEED[monthZhi];
  if (need !== undefined && lt(share(need), TH_MAX_SHARE)) {
    thElement = need;
    thShare = share(need);
    const cond = `${monthZhi}月${SEASON_WORD[need]}，${need}只占全盘 ${pct(thShare)}%`;
    if (yong === need || xi.includes(need)) {
      th = 'AGREE';
      basis.push(`${cond}，调候同样需要${need}，与扶抑结论一致。`);
    } else if (level === '中和偏弱' || level === '中和偏旺') {
      th = 'NEUTRAL-OVERRIDE';
      const oldYong = yong;
      const kill = keOf(need);
      const kept = xi.filter((e) => e !== kill);
      if (kept.length !== xi.length) thRemoved = kill;
      yong = need;
      xi = [oldYong, ...kept];
      ji = ji.filter((e) => e !== need);
      const keptNote = oldYong === kill ? '（扶抑选出的用神保留为第一喜神）' : '';
      basis.push(
        `${cond}，按调候改取${need}为用神，${oldYong}降为喜神${keptNote}` +
          (thRemoved === null
            ? '。'
            : `；${thRemoved}${REMOVED_REASON[thRemoved] ?? ''}，不列入喜神。`),
      );
    } else {
      th = 'ADD-XI';
      xi = [...xi, need];
      ji = ji.filter((e) => e !== need);
      basis.push(`${cond}，调候需要${need}，列为辅助喜神（${yong}仍是根本）。`);
    }
    rulesHit.push(
      ruleHit(`Y-TH-${th}`, '', {
        month: monthZhi,
        need,
        share: r4(thShare),
        max_share: TH_MAX_SHARE,
        level,
        ...(thRemoved === null ? {} : { removed: thRemoved }),
      }),
    );
  }

  // ⑤ 通关
  let tg = false;
  let tgElement: WuXing | null = null;
  let tongguan: TongguanCheck | null = null;
  const pair = tongguanPair(st.power, st.total);
  if (pair !== null) {
    const z = pair.element;
    const group = godGroupOf(dm, z);
    const check = {
      ...pair,
      group,
      direction_ok: TG_GROUPS[direction].includes(group),
      in_ji: ji.includes(z),
      is_yong: yong === z,
      already_xi: xi.includes(z),
    };
    const adopted = check.direction_ok && !check.in_ji && !check.is_yong && !check.already_xi;
    tongguan = { ...check, adopted };
    const fight = `${pair.attacker}克${pair.target}，两强相战，${z}可通关`;
    if (adopted) {
      tg = true;
      tgElement = z;
      xi = [...xi, z];
      rulesHit.push(
        ruleHit('Y-TG', '', {
          a: pair.a,
          b: pair.b,
          a_power: r4(st.power[pair.a]),
          b_power: r4(st.power[pair.b]),
          total: r4(st.total),
          min_share: TG_MIN_SHARE,
          element: z,
          group,
        }),
      );
      basis.push(
        `${pair.attacker}、${pair.target}各占全盘 ${pct(share(pair.attacker))}%、${pct(share(pair.target))}%，` +
          `${pair.attacker}克${pair.target}，取${z}通关，列入喜神。`,
      );
    } else if (!check.direction_ok) {
      notes.push(`${fight}，但与扶抑方向冲突，未采用`);
    } else if (check.in_ji) {
      notes.push(`${fight}，但${z}为忌神，未采用`);
    } else if (check.is_yong) {
      notes.push(`${fight}，${z}已是用神`);
    } else {
      notes.push(`${fight}，${z}已在喜神中`);
    }
  }

  return finish({
    yong,
    xi,
    ji,
    fy_rule: f.rule,
    fy,
    swap,
    swap_from: swapFrom,
    swap_to: swapTo,
    th,
    th_element: thElement,
    th_share: thShare,
    th_removed: thRemoved,
    tg,
    tg_element: tgElement,
    tongguan,
    notes,
    rules_hit: rulesHit,
    basis,
  });
}

/** ⑥ 闲神，并检查 §6 的互斥与完备（违反即代码缺陷，直接抛错）。 */
function finish(y: Omit<Yongshen, 'xian'>): Yongshen {
  const used = new Set<WuXing>([y.yong, ...y.xi, ...y.ji]);
  const xian = WUXING_ORDER.filter((e) => !used.has(e));
  const all = [y.yong, ...y.xi, ...y.ji, ...xian];
  if (all.length !== 5 || new Set(all).size !== 5) {
    throw new Error(
      '喜用神结果不满足 yongshen.md §6：用、喜、忌、闲必须两两不重复且合起来正好五个五行',
    );
  }
  return { ...y, xian };
}
