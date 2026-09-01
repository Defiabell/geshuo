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
