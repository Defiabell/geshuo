import type { Dialect, DialectLevel } from './types';

/**
 * 方言的颜色来自地理，不是随手挑的。
 *
 * **纬度定色相**：从北到南，青蓝 → 绿 → 橄榄 → 赭黄。相邻的方言颜色也相邻，
 * 这是真的——它们本来就挨着。地图上一眼看过去是一条从北到南的色带。
 *
 * **层级定饱和度**：大区最淡，点最实。这跟全站的虚实语法同向——层级越细、
 * 越接近一个具体的人，颜色越实，字也越锐利。所以颜色不只是标识，它在说
 * 「这条离真实有多近」。
 *
 * 没有坐标的节点（比如「官话」这种纯分类节点）返回中性墨色：不编一个位置。
 */

/** 色相区间：北端 46°N 给青蓝，南端 20°N 给赭黄 */
const LAT_NORTH = 46;
const LAT_SOUTH = 20;
const HUE_NORTH = 206;
const HUE_SOUTH = 18;

/** 层级越细，颜色越实 */
const SAT: Record<DialectLevel, number> = {
  supergroup: 26,
  group: 40,
  cluster: 47,
  subcluster: 53,
  point: 60,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function hueFor(lat: number): number {
  const t = clamp((LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH), 0, 1);
  return Math.round(HUE_NORTH - t * (HUE_NORTH - HUE_SOUTH));
}

/**
 * 给一个方言节点的主色。`lightness` 可调——正文用深色，光晕用亮色。
 * 没有坐标就返回墨色（var(--ink-2) 的等价值），不猜。
 */
export function colorFor(d: Pick<Dialect, 'lat' | 'level'>, lightness = 30): string {
  if (d.lat === undefined) return `hsl(30 8% ${lightness + 6}%)`;
  return `hsl(${hueFor(d.lat)} ${SAT[d.level] ?? 30}% ${lightness}%)`;
}
