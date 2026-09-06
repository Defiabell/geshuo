import type { Dialect, DialectLevel } from './types';

/**
 * 方言的颜色来自地理，不是随手挑的。
 *
 * **纬度定冷暖**：北端冷板岩蓝，南端赭红。相邻的方言颜色也相邻，这是真的——
 * 它们本来就挨着。地图上一眼看过去是一条从冷到暖的带子。
 *
 * **层级定实度**：大区最接近中性墨色，点最有颜色。这跟全站的虚实语法同向——
 * 层级越细、越接近一个具体的人，颜色越实，字也越锐利。所以颜色不只是标识，
 * 它在说「这条离真实有多近」。
 *
 * ## 为什么不用色相插值
 *
 * 上一版是「纬度 → HSL 色相」，从 206° 线性插到 18°。数学上没错，视觉上是灾难：
 * 中国的方言几乎全落在 23–44°N，映射过去正好是 40°–190° 这一段，而这一段的
 * **中间就是绿色**。结果四个方言渲染出来是「三个绿加一个褐」，读不出南北，
 * 只读得出「都挺绿」。
 *
 * 换成在 RGB 上直接插值两个锚点色，中途经过中性暖灰而不是绿。冷暖轴本来就是
 * 人对「北方/南方」最直觉的编码，比绕一圈色相环更贴题，也和这个站的墨与纸
 * 底色更合。
 */

/** 纬度区间：中国有人烟的方言点大致落在这两端之间 */
const LAT_NORTH = 46;
const LAT_SOUTH = 20;

type RGB = readonly [number, number, number];

/**
 * 冷暖色阶，从北到南。**手挑的，不是算出来的。**
 *
 * 试过两种算法都不行：
 * - 色相线性插值（206°→18°）中段是绿色，而中国方言几乎全在中纬度，
 *   结果四列渲染成「三个绿加一个褐」；
 * - 两端色 RGB 直插，中点掉进灰区——中纬度渲染成灰，比绿更糟。
 *
 * 所以改成分段插值一条挑好的色阶：蓝 → 灰蓝 → 灰紫 → 陶土 → 赭。全程有彩度、
 * 不经过绿，而且每一档都还在墨与纸这套底色里（中段的灰紫读起来像旧纸上的
 * 褪色墨，不是糖果紫）。
 */
const RAMP: readonly RGB[] = [
  [0x25, 0x55, 0x78], // 北：深板岩蓝
  [0x42, 0x51, 0x80], // 靛
  [0x70, 0x46, 0x6d], // 紫褐
  [0x96, 0x4c, 0x45], // 陶土
  [0xa8, 0x4a, 0x1c], // 南：赭红
];
/** 中性墨灰。层级越粗，颜色越往这里靠——「说不清是哪儿」的视觉形态 */
const NEUTRAL: RGB = [0x6b, 0x64, 0x5b];

/** 在色阶上取 t（0 = 最北，1 = 最南）处的颜色 */
function ramp(t: number): RGB {
  const x = clamp(t, 0, 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

/** 层级 → 离中性有多远。大区最接近中性，点最有颜色 */
const SOLIDITY: Record<DialectLevel, number> = {
  supergroup: 0.42,
  group: 0.66,
  cluster: 0.8,
  subcluster: 0.9,
  point: 1,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] as const;

/** 纬度归一化：0 = 最北，1 = 最南 */
export function warmth(lat: number): number {
  return clamp((LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH), 0, 1);
}

/**
 * 色相仍然导出，但只用于测试与调试——渲染走 colorFor。
 * 它是插值结果的色相角，反映的是同一条冷暖轴。
 */
export function hueFor(lat: number): number {
  const [r, g, b] = ramp(warmth(lat));
  return rgbToHsl(r, g, b)[0];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return [h, Math.round(s * 100), Math.round(l * 100)];
}

/**
 * 给一个方言节点的主色。`lightness` 可调——正文用深色，地图光晕用亮色。
 * 没有坐标就返回中性墨色（var(--ink-2) 的等价值），不猜一个位置。
 */
export function colorFor(d: Pick<Dialect, 'lat' | 'level'>, lightness = 30): string {
  if (d.lat === undefined) return `hsl(30 8% ${lightness + 6}%)`;
  const base = ramp(warmth(d.lat));
  const solid = SOLIDITY[d.level] ?? 0.66;
  const [r, g, b] = mix(NEUTRAL, base, solid);
  const [h, s] = rgbToHsl(r, g, b);
  return `hsl(${h} ${s}% ${lightness}%)`;
}
