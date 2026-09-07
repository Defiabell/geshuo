import type { Dialect, DialectLevel } from './types';

/**
 * 方言的颜色来自地理，不是随手挑的。
 *
 * **纬度定色相**：北端冷板岩蓝，南端赭红。相邻的方言颜色也相邻，这是真的——
 * 它们本来就挨着。地图上一眼看过去是一条从冷到暖的带子。
 *
 * **层级定彩度**：大区几乎是中性墨色，点最有颜色。这跟全站的虚实语法同向——
 * 层级越细、越接近一个具体的人，颜色越实，字也越锐利。所以颜色不只是标识，
 * 它在说「这条离真实有多近」。
 *
 * **明度只由用途定**：正文深、地图亮、色条中间。同一个方言在不同位置只差
 * 明度，不差色相和彩度。
 *
 * 三条轴，三种含义，互不串味——这是这一版最重要的性质。
 *
 * ## 为什么用 OKLCH，以及前三版怎么错的
 *
 * 1. **HSL 色相线性插值**（206°→18°）：数学上没错，视觉上是灾难。中国的方言
 *    几乎全落在 23–44°N，映过去正好是 HSL 色相环 40°–190° 那一段，而这一段的
 *    **中间就是绿色**。四个方言渲染出来是「三个绿加一个褐」。
 * 2. **两个锚点色在 sRGB 上直插**：中点掉进灰区，中纬度渲染成 9% 彩度的灰，
 *    比绿更糟。
 * 3. **手挑五档色阶 + HSL 固定明度**：颜色终于对了，但 **HSL 的 L 不是感知
 *    明度**。同样 L=38% 的赭黄看着比板岩蓝亮得多，于是色条最右那一段总是
 *    发白、像没上墨。这个毛病在整站都在：地图、列头、墨点。
 *
 * 所以这一版换成 OKLCH：L 是感知明度，同一个 L 的蓝和赭看起来一样重。
 * 手挑的那五档色阶保留下来，但**只保留它的色相路径**（下面的 HUE_PATH，
 * 由那五个十六进制色算出来的 Oklab 色相）。彩度和明度改由语义决定，
 * 不再跟着色相漂——那正是把「三条轴」互相解耦的那一步。
 *
 * 色相路径 243 → 269 → 329 → 27 → 44 是绕着洋红走的，全程不经过绿。
 */

/** 纬度区间：中国有人烟的方言点大致落在这两端之间 */
const LAT_NORTH = 46;
const LAT_SOUTH = 20;

/**
 * 色相路径（OKLCH 度数），从北到南。
 *
 * 这五个数不是挑好看的，是把上一版手挑的五档 sRGB 色阶
 * （#255578 #425180 #70466d #964c45 #a84a1c）转到 Oklab 之后的色相角。
 * 换句话说：那一版**配色的判断保留了，只是把彩度和明度从里面剥出来**。
 *
 * 数值单调递增（不取模），插值才不会在 360° 处回绕跳变；输出前再取模。
 */
const HUE_PATH = [243.1, 269.5, 329.3, 386.8, 403.5];

/**
 * 基准彩度。
 *
 * 全程一个值，不跟色相变——蓝和赭的天然彩度上限差得远（sRGB 里 L≈0.5 时
 * 蓝能到 ~0.15、赭能到 ~0.13），取 0.095 是两边都进得了色域的安全值。
 * 统一之后，一排颜色读起来是一条有秩序的色阶，而不是几块颜色。
 */
const BASE_CHROMA = 0.095;
/** 没有坐标时的彩度：几乎中性，但不是纯灰——纯灰在纸上像掉了色 */
const NEUTRAL_CHROMA = 0.008;
/** 没有坐标时的色相：暖灰，跟纸的底色同向 */
const NEUTRAL_HUE = 70;

/** 层级 → 彩度系数。大区最接近中性，点最有颜色 */
const SOLIDITY: Record<DialectLevel, number> = {
  supergroup: 0.42,
  group: 0.66,
  cluster: 0.8,
  subcluster: 0.9,
  point: 1,
};

/** 全站默认明度（OKLCH 的 L，0–1）。正文与列头用这一档 */
export const L_TEXT = 0.42;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 纬度归一化：0 = 最北，1 = 最南 */
export function warmth(lat: number): number {
  return clamp((LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH), 0, 1);
}

/** 色相路径上 t（0 = 最北，1 = 最南）处的角度，已取模到 [0,360) */
function hueAt(t: number): number {
  const x = clamp(t, 0, 1) * (HUE_PATH.length - 1);
  const i = Math.min(Math.floor(x), HUE_PATH.length - 2);
  return lerp(HUE_PATH[i], HUE_PATH[i + 1], x - i) % 360;
}

/** 纬度 → OKLCH 色相。渲染与测试走的是同一条路径 */
export function hueFor(lat: number): number {
  return Number(hueAt(warmth(lat)).toFixed(1));
}

function css(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(4)} ${h.toFixed(1)})`;
}

/**
 * 色阶的 n 个等距档位，从最北到最南。**报头就是这个站的图例。**
 *
 * 「各说各话」四个字，一字一色，取的正是这条轴的四档。它不挂在任何具体
 * 地方上（那件事由色条和地图负责），它说的是这个站的组织方式：**从北到南**。
 *
 * 用满彩度：图例要的是这条轴最饱满的样子，不按层级往中性靠。
 */
export function rampStops(n: number, l = L_TEXT): string[] {
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) =>
    css(l, BASE_CHROMA, hueAt(n === 1 ? 0.5 : i / (n - 1))),
  );
}

/**
 * 给一个方言节点的主色。`l` 是感知明度（0–1）——正文用 L_TEXT，
 * 地图光晕和色条按需调亮，色相与彩度不变。
 *
 * 没有坐标就返回近中性的暖灰，不猜一个位置。
 */
export function colorFor(d: Pick<Dialect, 'lat' | 'level'>, l = L_TEXT): string {
  if (d.lat === undefined) return css(l + 0.06, NEUTRAL_CHROMA, NEUTRAL_HUE);
  const solid = SOLIDITY[d.level] ?? 0.66;
  return css(l, BASE_CHROMA * solid, hueAt(warmth(d.lat)));
}
