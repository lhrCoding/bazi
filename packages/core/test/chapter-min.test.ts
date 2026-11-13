/**
 * D12：章节字数下限的放宽情形（只有一步大运可写时第 5 章 550；没有当前大运时第 7 章 700；三柱第 3 章 550）。
 */
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/report/ctx';
import { CHAPTER_LENGTH, chapterMin } from '../src/report/check';

const ctxWith = (phases: string[]): Ctx =>
  ({ dayun: phases.map((phase) => ({ phase })) }) as unknown as Ctx;
const base = (ch: number) => (CHAPTER_LENGTH[ch] as readonly [number, number])[0];

describe('chapterMin', () => {
  it('当前 + 下一步都有：第 5、7 章用 §2 下限', () => {
    const c = ctxWith(['past', 'current', 'next', 'far']);
    expect(chapterMin(5, base(5), true, c)).toBe(750);
    expect(chapterMin(7, base(7), true, c)).toBe(800);
  });
  it('年长者（已无下一步）：第 5 章 550，第 7 章不变', () => {
    const c = ctxWith(['past', 'past', 'current']);
    expect(chapterMin(5, base(5), true, c)).toBe(550);
    expect(chapterMin(7, base(7), true, c)).toBe(800);
  });
  it('尚未起运（无当前大运）：第 5 章 550，第 7 章 700', () => {
    const c = ctxWith(['next', 'far', 'far']);
    expect(chapterMin(5, base(5), true, c)).toBe(550);
    expect(chapterMin(7, base(7), true, c)).toBe(700);
  });
  it('三柱：第 3 章 550；其余章节不受时辰影响', () => {
    const c = ctxWith(['past', 'current', 'next']);
    expect(chapterMin(3, base(3), false, c)).toBe(550);
    expect(chapterMin(3, base(3), true, c)).toBe(650);
    expect(chapterMin(2, base(2), false, c)).toBe(450);
  });
});
