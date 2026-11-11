/**
 * 条件树求值（TASKS T23；rules/texts/README.md §4、ARCHITECTURE §4.3.3）。
 *
 * - 条件是数据树，不是字符串表达式：只解释 all / any / not 组合子与 11 个叶子运算符，**不 eval 任何字符串**。
 * - 空条件 {} 恒为真（只允许兜底条目使用，由 lint 检查）。
 * - 空值语义（§4.3）：字段值为 null / 不存在时，只有 `exists: false` 为真，其余运算符（含 ne / not_in / not_contains）一律为假。
 *   三柱时 hour 相关字段为 null，引用它们的条件自然不成立——槽位降级就靠这个，引擎里不写三柱特殊分支。
 *   `not` 只是对子条件结果取反：not({f: X, eq: 甲}) 在 X 为 null 时为真（子条件为假）。
 * - 类型不符（如对列表用 eq、对非数值用 gte）一律为假；字段与运算符是否搭配由 lint（T24 L2）在入库前拦截。
 * - contains / not_contains：值为标量时判断列表是否包含；值为对象时，列表中存在一个元素其「给出的键全部相等」即算包含
 *   （对象列表 relations，如 {type: 冲, a: 流年支, b: 日支}）。
 * - 深度：组合子嵌套层数，叶子与 {} 为 0；超过 MAX_CONDITION_DEPTH（3）抛错。
 * - 特异度：叶子条件个数（README §5.1 排序第二键）。
 */
import type { Condition, LeafOp } from './schema';
import { LEAF_OPS } from './schema';

export const MAX_CONDITION_DEPTH = 3;

/** 求值上下文：按点分路径取值（如 gods.比劫_pct → ctx.gods['比劫_pct']；item.* → ctx.item） */
export type EvalContext = Readonly<Record<string, unknown>>;

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionError';
  }
}

type Scalar = string | number | boolean;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 按路径取值；任何一段不存在（含原型链上的属性）都返回 undefined */
export function resolveField(ctx: EvalContext, path: string): unknown {
  let cur: unknown = ctx;
  for (const key of path.split('.')) {
    if (!isObject(cur) || !Object.hasOwn(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function leafOp(node: Record<string, unknown>): LeafOp {
  const ops = Object.keys(node).filter((k) => k !== 'f');
  const op = ops[0];
  if (ops.length !== 1 || !(LEAF_OPS as readonly string[]).includes(op as string)) {
    throw new ConditionError(`叶子条件必须恰好一个合法运算符：${JSON.stringify(node)}`);
  }
  return op as LeafOp;
}

function matchesElement(el: unknown, want: unknown): boolean {
  if (isObject(want)) {
    return (
      isObject(el) && Object.entries(want).every(([k, v]) => Object.hasOwn(el, k) && el[k] === v)
    );
  }
  return el === want;
}

function evalLeaf(node: Record<string, unknown>, ctx: EvalContext): boolean {
  const op = leafOp(node);
  const arg = node[op];
  const v = resolveField(ctx, node.f as string);
  if (v === null || v === undefined) return op === 'exists' && arg === false;
  switch (op) {
    case 'exists':
      return arg === true;
    case 'eq':
      return !Array.isArray(v) && !isObject(v) && v === arg;
    case 'ne':
      return !Array.isArray(v) && !isObject(v) && v !== arg;
    case 'in':
      return Array.isArray(arg) && !Array.isArray(v) && !isObject(v) && arg.includes(v as Scalar);
    case 'not_in':
      return Array.isArray(arg) && !Array.isArray(v) && !isObject(v) && !arg.includes(v as Scalar);
    case 'contains':
      return Array.isArray(v) && v.some((el) => matchesElement(el, arg));
    case 'not_contains':
      return Array.isArray(v) && !v.some((el) => matchesElement(el, arg));
    case 'gte':
      return typeof v === 'number' && typeof arg === 'number' && v >= arg;
    case 'gt':
      return typeof v === 'number' && typeof arg === 'number' && v > arg;
    case 'lte':
      return typeof v === 'number' && typeof arg === 'number' && v <= arg;
    case 'lt':
      return typeof v === 'number' && typeof arg === 'number' && v < arg;
  }
}

function kindOf(node: unknown): 'empty' | 'all' | 'any' | 'not' | 'leaf' {
  if (!isObject(node)) throw new ConditionError(`条件必须是对象：${JSON.stringify(node)}`);
  const keys = Object.keys(node);
  if (keys.length === 0) return 'empty';
  if (keys.length === 1 && (keys[0] === 'all' || keys[0] === 'any' || keys[0] === 'not'))
    return keys[0];
  if (typeof node.f === 'string') return 'leaf';
  throw new ConditionError(`无法识别的条件：${JSON.stringify(node)}`);
}

function children(node: Record<string, unknown>, key: 'all' | 'any'): unknown[] {
  const c = node[key];
  if (!Array.isArray(c) || c.length === 0) throw new ConditionError(`${key} 必须是非空数组`);
  return c;
}

/** 组合子嵌套层数（叶子、{} 为 0） */
export function conditionDepth(cond: Condition): number {
  const node = cond as unknown as Record<string, unknown>;
  const k = kindOf(node);
  if (k === 'empty' || k === 'leaf') return 0;
  if (k === 'not') return 1 + conditionDepth(node.not as Condition);
  return 1 + Math.max(...children(node, k).map((c) => conditionDepth(c as Condition)));
}

/** 特异度 = 叶子条件个数 */
export function specificity(cond: Condition): number {
  const node = cond as unknown as Record<string, unknown>;
  const k = kindOf(node);
  if (k === 'empty') return 0;
  if (k === 'leaf') return 1;
  if (k === 'not') return specificity(node.not as Condition);
  return children(node, k).reduce<number>((s, c) => s + specificity(c as Condition), 0);
}

/** 条件引用的全部字段（去重，按首次出现顺序），供 lint 与覆盖率使用 */
export function conditionFields(cond: Condition): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    const node = n as Record<string, unknown>;
    const k = kindOf(node);
    if (k === 'leaf') {
      if (!out.includes(node.f as string)) out.push(node.f as string);
    } else if (k === 'not') walk(node.not);
    else if (k === 'all' || k === 'any') children(node, k).forEach(walk);
  };
  walk(cond);
  return out;
}

function evalNode(node: unknown, ctx: EvalContext): boolean {
  const n = node as Record<string, unknown>;
  switch (kindOf(n)) {
    case 'empty':
      return true;
    case 'leaf':
      return evalLeaf(n, ctx);
    case 'not':
      return !evalNode(n.not, ctx);
    case 'all':
      return children(n, 'all').every((c) => evalNode(c, ctx));
    case 'any':
      return children(n, 'any').some((c) => evalNode(c, ctx));
  }
}

/** 求值；深度超过 3 抛 ConditionError */
export function evaluateCondition(cond: Condition, ctx: EvalContext): boolean {
  const d = conditionDepth(cond);
  if (d > MAX_CONDITION_DEPTH) {
    throw new ConditionError(`条件嵌套深度 ${d} 超过上限 ${MAX_CONDITION_DEPTH}`);
  }
  return evalNode(cond, ctx);
}

/** when 与 asserts 都成立（README §5.1） */
export function entryMatches(
  entry: { when: Condition; asserts: readonly Condition[] },
  ctx: EvalContext,
): boolean {
  return (
    evaluateCondition(entry.when, ctx) && entry.asserts.every((a) => evaluateCondition(a, ctx))
  );
}
