/**
 * cases.json 对照断言工具（按 _meta.test_guidance）。
 *
 * 设计：
 * - FIELD_CHECKS：每个可比对字段一条（字段键、负责任务、比对方式、从 expected 取值的方法）。
 * - PENDING_FIELDS：显式「待实现」清单。在清单里的字段跳过比对，并在测试输出中逐条列出；
 *   不在清单里的字段一律比对，引擎没输出该字段即失败（不能静默通过）。
 * - NOT_COMPARED：cases.json 里存在、但本对照测试不比对的字段（附原因与负责任务）。
 *   expected 中出现既不在 FIELD_CHECKS 也不在 NOT_COMPARED 的字段时测试失败，防止 cases.json 新增字段被漏比。
 * - 期望值为 null 且该字段 null 表示「待复核」（如 C20 起运字段）时，跳过并列入「期望值待复核」清单。
 */
import type { RawExpected } from './cases';

// ---------- 比对方式 ----------

export type CompareKind =
  | { type: 'exact' }
  | { type: 'number'; tol: number }
  | { type: 'numberRecord'; tol: number }
  | { type: 'dateWithinDays'; days: number }
  | { type: 'rulesHitPrefix' };

/** 浮点比较的额外余量，避免 0.1 + 0.2 之类的表示误差导致边界值误判。 */
const EPS = 1e-9;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    return deepEqual(ak, bk) && ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function parseDay(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** 规则编号：取冒号（半角或全角）前的部分。 */
export function ruleIdOf(s: string): string {
  return (s.split(/[:：]/)[0] ?? '').trim();
}

const show = (v: unknown) => JSON.stringify(v);

/**
 * 比较单个字段。返回 null 表示一致，否则返回差异说明。
 */
export function compareField(kind: CompareKind, expected: unknown, actual: unknown): string | null {
  switch (kind.type) {
    case 'exact':
      return deepEqual(expected, actual) ? null : `期望 ${show(expected)}，实际 ${show(actual)}`;

    case 'number': {
      if (typeof expected !== 'number' || typeof actual !== 'number' || !Number.isFinite(actual)) {
        return `期望数值 ${show(expected)}，实际 ${show(actual)}`;
      }
      const d = Math.abs(actual - expected);
      return d <= kind.tol + EPS
        ? null
        : `期望 ${expected} ±${kind.tol}，实际 ${actual}（差 ${d}）`;
    }

    case 'numberRecord': {
      if (
        typeof expected !== 'object' ||
        expected === null ||
        typeof actual !== 'object' ||
        actual === null
      ) {
        return `期望 ${show(expected)}，实际 ${show(actual)}`;
      }
      const e = expected as Record<string, unknown>;
      const a = actual as Record<string, unknown>;
      const ek = Object.keys(e).sort();
      const ak = Object.keys(a).sort();
      if (!deepEqual(ek, ak)) return `键不一致：期望 ${show(ek)}，实际 ${show(ak)}`;
      const bad = ek.flatMap((k) => {
        const r = compareField({ type: 'number', tol: kind.tol }, e[k], a[k]);
        return r === null ? [] : [`${k}: ${r}`];
      });
      return bad.length === 0 ? null : bad.join('；');
    }

    case 'dateWithinDays': {
      const e = parseDay(expected);
      const a = parseDay(actual);
      if (e === null || a === null) return `期望日期 ${show(expected)}，实际 ${show(actual)}`;
      const d = Math.abs(a - e);
      return d <= kind.days
        ? null
        : `期望 ${String(expected)} ±${kind.days} 天，实际 ${String(actual)}（差 ${d} 天）`;
    }

    case 'rulesHitPrefix': {
      if (
        !Array.isArray(expected) ||
        !Array.isArray(actual) ||
        !actual.every((x) => typeof x === 'string')
      ) {
        return `期望 ${show(expected)}，实际 ${show(actual)}`;
      }
      const have = new Set((actual as string[]).map(ruleIdOf));
      const missing = (expected as string[]).map(ruleIdOf).filter((id) => !have.has(id));
      return missing.length === 0 ? null : `缺少规则编号 ${show(missing)}，实际 ${show([...have])}`;
    }
  }
}

// ---------- 字段注册表 ----------

/** 取值结果：不适用（该案例没有此字段）/ 待复核（期望值为 null 且 null 表示未算）/ 正常值 */
export type ExpectedValue =
  | { status: 'absent' }
  | { status: 'pendingReview'; reason: string }
  | { status: 'value'; value: unknown };

export interface FieldCheck {
  key: string;
  /** 负责实现的任务（仅用于输出） */
  task: string;
  kind: CompareKind;
  /** 本检查覆盖的 expected 字段路径（用于「未覆盖字段」守卫） */
  sources: string[];
  extract: (e: RawExpected) => ExpectedValue;
}

function get(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const REVIEW_REASON = '期望值为 null（cases.json 注明待 T21 代码复核补全）';

/** null 是真实期望值（如三柱的时柱、无特殊格局） */
function byPath(path: string): (e: RawExpected) => ExpectedValue {
  return (e) => {
    const v = get(e, path);
    return v === undefined ? { status: 'absent' } : { status: 'value', value: v };
  };
}

/** null 表示期望值尚未算出（待复核） */
function byPathReviewable(path: string): (e: RawExpected) => ExpectedValue {
  return (e) => {
    const v = get(e, path);
    if (v === undefined) return { status: 'absent' };
    if (v === null) return { status: 'pendingReview', reason: REVIEW_REASON };
    return { status: 'value', value: v };
  };
}

function first3(field: 'ganzhi' | 'start_year'): (e: RawExpected) => ExpectedValue {
  return (e) => {
    const steps = get(e, 'dayun.first3');
    if (!Array.isArray(steps)) return { status: 'absent' };
    const vals = steps.map((s) => get(s, field));
    if (vals.some((v) => v === null)) return { status: 'pendingReview', reason: REVIEW_REASON };
    return { status: 'value', value: vals };
  };
}

const exact: CompareKind = { type: 'exact' };

export const FIELD_CHECKS: readonly FieldCheck[] = [
  {
    key: 'pillars.year',
    task: 'T04',
    kind: exact,
    sources: ['pillars.year'],
    extract: byPath('pillars.year'),
  },
  {
    key: 'pillars.month',
    task: 'T04',
    kind: exact,
    sources: ['pillars.month'],
    extract: byPath('pillars.month'),
  },
  {
    key: 'pillars.day',
    task: 'T07',
    kind: exact,
    sources: ['pillars.day'],
    extract: byPath('pillars.day'),
  },
  {
    key: 'pillars.hour',
    task: 'T07 / T11',
    kind: exact,
    sources: ['pillars.hour'],
    extract: byPath('pillars.hour'),
  },
  {
    key: 'alt.zi_huanri_day_pillar',
    task: 'T07',
    kind: exact,
    sources: ['alt_zi_huanri_school.day'],
    extract: byPath('alt_zi_huanri_school.day'),
  },
  {
    key: 'dayun.direction',
    task: 'T09',
    kind: exact,
    sources: ['dayun.direction'],
    extract: byPath('dayun.direction'),
  },
  {
    key: 'dayun.first3.ganzhi',
    task: 'T09',
    kind: exact,
    sources: ['dayun.first3'],
    extract: first3('ganzhi'),
  },
  {
    key: 'dayun.first3.start_year',
    task: 'T09',
    kind: exact,
    sources: ['dayun.first3'],
    extract: first3('start_year'),
  },
  {
    key: 'dayun.qiyun_date',
    task: 'T09',
    kind: { type: 'dateWithinDays', days: 1 },
    sources: ['dayun.qiyun_date'],
    extract: byPathReviewable('dayun.qiyun_date'),
  },
  {
    key: 'strength.S',
    task: 'T15',
    kind: { type: 'number', tol: 0.001 },
    sources: ['strength.S'],
    extract: byPath('strength.S'),
  },
  {
    key: 'strength.power',
    task: 'T15',
    kind: { type: 'numberRecord', tol: 0.01 },
    sources: ['strength.power'],
    extract: byPath('strength.power'),
  },
  {
    key: 'strength.gods',
    task: 'T15',
    kind: { type: 'numberRecord', tol: 0.01 },
    sources: ['strength.gods'],
    extract: byPath('strength.gods'),
  },
  {
    key: 'strength.de_ling',
    task: 'T15',
    kind: exact,
    sources: ['strength.de_ling'],
    extract: byPath('strength.de_ling'),
  },
  {
    key: 'strength.de_di',
    task: 'T15',
    kind: exact,
    sources: ['strength.de_di'],
    extract: byPath('strength.de_di'),
  },
  {
    key: 'strength.de_shi',
    task: 'T15',
    kind: exact,
    sources: ['strength.de_shi'],
    extract: byPath('strength.de_shi'),
  },
  {
    key: 'strength.level',
    task: 'T16',
    kind: exact,
    sources: ['strength.level'],
    extract: byPath('strength.level'),
  },
  {
    key: 'strength.special',
    task: 'T16',
    kind: exact,
    sources: ['strength.special'],
    extract: byPath('strength.special'),
  },
  {
    key: 'strength.borderline',
    task: 'T16',
    kind: exact,
    sources: ['strength.borderline'],
    extract: byPath('strength.borderline'),
  },
  {
    key: 'yongshen',
    task: 'T17',
    kind: exact,
    sources: ['yongshen.yong', 'yongshen.xi', 'yongshen.ji', 'yongshen.xian'],
    extract: byPath('yongshen'),
  },
  {
    key: 'rules_hit',
    task: 'T15–T17',
    kind: { type: 'rulesHitPrefix' },
    sources: ['rules_hit_expected'],
    extract: byPath('rules_hit_expected'),
  },
  {
    key: 'shensha_ji',
    task: 'T19',
    kind: exact,
    sources: ['shensha_ji'],
    extract: byPath('shensha_ji'),
  },
];

/**
 * 显式「待实现」清单：字段键 → 负责任务。
 * 某任务完成后，从这里删掉对应字段，并在 cases.test.ts 的 computeActual 中输出该字段。
 */
export const PENDING_FIELDS: Readonly<Record<string, string>> = {
  'pillars.day': 'T07',
  'pillars.hour': 'T07 / T11',
  'alt.zi_huanri_day_pillar': 'T07',
  'dayun.direction': 'T09',
  'dayun.first3.ganzhi': 'T09',
  'dayun.first3.start_year': 'T09',
  'dayun.qiyun_date': 'T09',
  'strength.S': 'T15',
  'strength.power': 'T15',
  'strength.gods': 'T15',
  'strength.de_ling': 'T15',
  'strength.de_di': 'T15',
  'strength.de_shi': 'T15',
  'strength.level': 'T16',
  'strength.special': 'T16',
  'strength.borderline': 'T16',
  yongshen: 'T17',
  rules_hit: 'T15–T17',
  shensha_ji: 'T19',
};

/** cases.json 中存在但本对照测试不比对的字段（路径 → 原因）。 */
export const NOT_COMPARED: Readonly<Record<string, string>> = {
  'alt_zi_huanri_school.hour':
    'Chart 只输出 A 派日柱（calendar.md §9）；两派时柱相同，已由 pillars.hour 覆盖',
  'alt_zi_huanri_school.same_as_main': '说明性字段，由 day 推出',
  'alt_zi_huanri_school.note': '说明文字',
  wrong_if_not_corrected:
    '说明性字段（未做时区 / 真太阳时校正时的错误结果），T05 / T06 专项用例使用',
  'dayun.qiyun_offset': 'test_guidance 未要求；起运时刻由 dayun.qiyun_date（±1 天）覆盖',
  no_hour: '三柱时辰扫描与置信度，T18 专项测试比对',
  shensha_ji_alt_group: '交节日另一组年月柱的吉神，T19 专项测试比对',
  shensha_ji_display_if_uncertain: '交节日不确定时的吉神展示（jishen_display），T19 专项测试比对',
};

/**
 * 列出 expected 的字段路径：对象字段展开一层（如 strength.S），数组与标量保持原名（如 shensha_ji）。
 */
export function expectedFieldPaths(e: RawExpected): string[] {
  return Object.entries(e).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.keys(v).map((sub) => `${k}.${sub}`)
      : [k],
  );
}

/** 返回 expected 中既未被比对、也未声明「不比对」的字段路径（NOT_COMPARED 的键按前缀匹配）。 */
export function uncoveredFields(e: RawExpected): string[] {
  const covered = new Set(FIELD_CHECKS.flatMap((c) => c.sources));
  const skipped = Object.keys(NOT_COMPARED);
  return expectedFieldPaths(e).filter(
    (p) => !covered.has(p) && !skipped.some((k) => p === k || p.startsWith(`${k}.`)),
  );
}

// ---------- 实际输出 ----------

/** 引擎实际输出，按字段键扁平存放（由 Chart / Analysis 转换而来）。 */
export type CaseActual = Readonly<Record<string, unknown>>;

export interface CaseCheckResult {
  key: string;
  outcome: 'pass' | 'fail' | 'pending' | 'pendingReview' | 'absent';
  detail: string | null;
}

/** 对单个案例的单个字段执行比对。 */
export function checkCaseField(
  check: FieldCheck,
  expected: RawExpected,
  actual: CaseActual,
  pending: Readonly<Record<string, string>> = PENDING_FIELDS,
): CaseCheckResult {
  const ev = check.extract(expected);
  if (ev.status === 'absent') return { key: check.key, outcome: 'absent', detail: null };
  if (check.key in pending) {
    return { key: check.key, outcome: 'pending', detail: `待实现（${pending[check.key]}）` };
  }
  if (ev.status === 'pendingReview')
    return { key: check.key, outcome: 'pendingReview', detail: ev.reason };
  if (!(check.key in actual)) {
    return {
      key: check.key,
      outcome: 'fail',
      detail: '引擎未输出该字段（已移出待实现清单，但 computeActual 未提供）',
    };
  }
  const diff = compareField(check.kind, ev.value, actual[check.key]);
  return { key: check.key, outcome: diff === null ? 'pass' : 'fail', detail: diff };
}
