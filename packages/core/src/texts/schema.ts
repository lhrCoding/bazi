/**
 * 素材条目 schema（TASKS T22；rules/texts/README.md §2、§4.1）。
 *
 * 只校验结构与字段格式（L1 的 schema 部分）；字段是否在字典里、槽位是否存在、维度限制、字数等由 lint（T24 / T25）检查。
 * 条件树在这里只校验形状：组合子 all / any / not 与 11 个叶子运算符；求值与深度限制见 T23。
 */
import { z } from 'zod';

export const LEAF_OPS = [
  'eq',
  'ne',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'gte',
  'gt',
  'lte',
  'lt',
  'exists',
] as const;
export type LeafOp = (typeof LEAF_OPS)[number];

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const ScalarRecord = z.record(z.string(), Scalar).refine((o) => Object.keys(o).length > 0);

export type Leaf = { f: string } & Partial<Record<LeafOp, unknown>>;
export type Condition =
  Record<string, never> | { all: Condition[] } | { any: Condition[] } | { not: Condition } | Leaf;

const LeafSchema = z.record(z.string(), z.unknown()).superRefine((o, ctx) => {
  const keys = Object.keys(o);
  if (typeof o.f !== 'string' || o.f === '') {
    ctx.addIssue({ code: 'custom', message: '叶子条件缺少字段名 f' });
    return;
  }
  const ops = keys.filter((k) => k !== 'f');
  if (ops.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: `叶子条件必须恰好一个运算符，实际 ${JSON.stringify(ops)}`,
    });
    return;
  }
  const op = ops[0] as string;
  if (!(LEAF_OPS as readonly string[]).includes(op)) {
    ctx.addIssue({ code: 'custom', message: `未知运算符 ${op}` });
    return;
  }
  const v = o[op];
  const ok =
    op === 'exists'
      ? typeof v === 'boolean'
      : op === 'in' || op === 'not_in'
        ? Array.isArray(v) && v.length > 0 && v.every((x) => Scalar.safeParse(x).success)
        : op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt'
          ? typeof v === 'number'
          : op === 'contains' || op === 'not_contains'
            ? // 对象列表（relations）按「给出的键全部相等」匹配元素，如 {type: 冲, a: 流年支, b: 日支}
              Scalar.safeParse(v).success || ScalarRecord.safeParse(v).success
            : Scalar.safeParse(v).success;
  if (!ok)
    ctx.addIssue({ code: 'custom', message: `运算符 ${op} 的取值类型不对：${JSON.stringify(v)}` });
});

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({}),
    z.strictObject({ all: z.array(ConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1) }),
    z.strictObject({ not: ConditionSchema }),
    LeafSchema as unknown as z.ZodType<Leaf>,
  ]),
) as z.ZodType<Condition>;

export const ENTRY_ID_RE = /^(CH\d|FREE)-[A-Z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const QuoteSchema = z.strictObject({
  text: z.string().min(1),
  source: z.string().min(1),
  verified: z.boolean(),
  edition: z.string(),
});

export const TEXT_STATUSES = ['draft', 'reviewed', 'approved', 'retired'] as const;

export const TextEntrySchema = z.strictObject({
  id: z.string().regex(ENTRY_ID_RE, 'id 只用大写字母、数字、连字符，形如 CH2-METHOD-W-SHA'),
  slot: z.string().min(1),
  when: ConditionSchema,
  asserts: z.array(ConditionSchema).default([]),
  priority: z.int().min(0).max(100),
  fallback: z.boolean().default(false),
  requires_hour: z.boolean().default(false),
  length: z
    .tuple([z.int().nonnegative(), z.int().positive()])
    .refine(([a, b]) => a <= b, '字数区间下限不得大于上限'),
  polish_allowed: z.boolean().optional(),
  quote: QuoteSchema.optional(),
  variants: z
    .array(
      z
        .string()
        .min(1)
        .refine((s) => !/[\r\n]/.test(s), '变体是一段，不得含换行'),
    )
    .min(1)
    .max(3),
  status: z.enum(TEXT_STATUSES),
  author: z.string().min(1),
  reviewer: z.string().min(1).nullable(),
  updated: z.string().regex(DATE_RE, 'updated 格式为 YYYY-MM-DD'),
  notes: z.string().optional(),
});

export type TextEntry = z.infer<typeof TextEntrySchema>;
