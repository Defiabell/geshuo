/**
 * 地图投影。等距圆柱 + 纬度拉伸——不精确，但**轮廓和方言点用的是同一个函数**，
 * 所以点永远落在轮廓的正确位置上。这是选它的唯一理由，不是因为它准。
 *
 * 轮廓路径由 scripts/gen/src/build-map.ts 在构建期用这里的 project() 预先算好
 * 存进 src/data/china-outline.json；页面上的方言点在渲染时再调一次同一个函数。
 * 两边一旦用了不同的投影，点就会飘到海里去——tests/geo.test.ts 盯着这件事。
 */

/** 纬度拉伸系数：直接用 lat 会把中国压扁，按中纬度 35° 补偿 */
export const LAT_K = 1 / Math.cos((35 * Math.PI) / 180);

export function project(lng: number, lat: number): [number, number] {
  return [lng, -lat * LAT_K];
}

/**
 * 纬度 → 立体声声像。**北在左，南在右。**
 *
 * 为什么值得做：这个站的核心动作是「横着听」——同一句话在几个地方连着响。
 * 在此之前那只是一个播放列表：四段音频首尾相接，中间一段空白。声音本身
 * 没有被设计过。
 *
 * 把纬度映到声像之后，连听变成一次**从北到南的移动**：声音真的从左耳走到
 * 右耳。这不是特效——对比页的列本来就按纬度从北到南排，所以声音是从它那
 * 一列所在的位置传来的，视觉和听觉指的是同一个地方。
 *
 * 幅度只到 ±0.62，不推满：推满之后单耳听或者外放的人会整段丢掉一侧的内容，
 * 而这个站的内容是不能丢的。
 */
const PAN_MAX = 0.62;

export function panFor(lat: number | undefined): number {
  // 没有坐标的节点摆正中间——不编一个方位，跟 colorFor 对没有坐标的节点
  // 返回中性墨色是同一条原则
  if (lat === undefined) return 0;
  const LAT_NORTH = 46;
  const LAT_SOUTH = 20;
  const t = Math.min(1, Math.max(0, (LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH)));
  return Number(((t * 2 - 1) * PAN_MAX).toFixed(3));
}
