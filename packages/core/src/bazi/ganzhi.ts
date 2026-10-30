/**
 * 天干、地支与 60 甲子的基础常量（纯数据，无依赖）。
 */

export const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
export const DI_ZHI = [
  '子',
  '丑',
  '寅',
  '卯',
  '辰',
  '巳',
  '午',
  '未',
  '申',
  '酉',
  '戌',
  '亥',
] as const;

export type Gan = (typeof TIAN_GAN)[number];
export type Zhi = (typeof DI_ZHI)[number];

/**
 * 干支（两个字）。类型层面允许 10×12 种组合，
 * 是否属于 60 甲子（干支阴阳相同）由 isGanZhi 在运行时判断。
 */
export type GanZhi = `${Gan}${Zhi}`;

export function isGan(s: string): s is Gan {
  return (TIAN_GAN as readonly string[]).includes(s);
}

export function isZhi(s: string): s is Zhi {
  return (DI_ZHI as readonly string[]).includes(s);
}

/** 是否为 60 甲子中的合法干支（天干、地支序号奇偶相同）。 */
export function isGanZhi(s: string): s is GanZhi {
  const chars = Array.from(s);
  if (chars.length !== 2) return false;
  const [g, z] = chars as [string, string];
  if (!isGan(g) || !isZhi(z)) return false;
  return TIAN_GAN.indexOf(g) % 2 === DI_ZHI.indexOf(z) % 2;
}

/** 60 甲子序号 → 干支（0 = 甲子；任意整数按 60 取模，负数同样适用）。 */
export function ganZhiAt(index: number): GanZhi {
  const i = ((index % 60) + 60) % 60;
  return `${TIAN_GAN[i % 10] as Gan}${DI_ZHI[i % 12] as Zhi}`;
}

/** 由天干序号（0 = 甲）与地支序号（0 = 子）组成干支；两者阴阳不同时抛错。 */
export function ganZhiOf(ganIndex: number, zhiIndex: number): GanZhi {
  const g = ((ganIndex % 10) + 10) % 10;
  const z = ((zhiIndex % 12) + 12) % 12;
  if (g % 2 !== z % 2) throw new Error('天干地支阴阳不一致，不是合法的 60 甲子');
  return `${TIAN_GAN[g] as Gan}${DI_ZHI[z] as Zhi}`;
}
