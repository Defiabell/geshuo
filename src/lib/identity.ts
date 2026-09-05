import { levelLabel } from './dialect-tree';
import type { Dialect, DialectLevel, Place, Take } from './types';

/**
 * 一列内容的「身份」——页面只面对这一种东西，不用关心它背后是方言区还是行政区划。
 *
 * 为什么需要这层：2026-09-05 把真人贡献的主键从方言区换成了县级行政区划，于是
 * 一列可能是 AI 挂在「成渝片」上，也可能是真人挂在「371428 武城县」上。页面
 * 原先直接 `dialects.get(take.dialectId)`，遇到真人列就拿到 undefined，然后在
 * `.lat` 上炸掉。与其在每个页面写一次 if，不如把两种来源归一成同一个形状。
 *
 * 归一化的关键是 `level`：地点一律算 point（县域颗粒）。这不是凑数——全站的
 * 视觉语法（src/lib/palette.ts 的饱和度、虚实语法的锐利度）都吃这个字段，
 * 而「越接近一个具体的人越实」正好等价于「层级越细越实」。真人来自某个县，
 * 所以真人自动落在最实的那一档，不需要额外规则。
 */
export interface Identity {
  /** 路由段与去重键：AI 是方言 id，真人是六位行政区划代码 */
  id: string;
  name: string;
  level: DialectLevel;
  levelLabel: string;
  lng?: number;
  lat?: number;
  /** AI 列的方言节点；真人列则是该县的方言归属注释（可能没有） */
  dialect?: Dialect;
  /** 真人列的行政区划 */
  place?: Place;
}

export function identityOf(
  take: Take,
  dialects: Map<string, Dialect>,
  places: Map<string, Place>,
): Identity {
  if (take.placeCode !== undefined) {
    const pl = places.get(take.placeCode);
    if (!pl) throw new Error(`演绎 ${take.id} 指向未登记的行政区划：${take.placeCode}`);
    return {
      id: pl.code,
      // 「山东武城县」比「武城县」好认——同名县在全国不止一个
      name: `${pl.province.replace(/[省市]$/, '')}${pl.name}`,
      level: 'point',
      levelLabel: '县',
      lng: pl.lng,
      lat: pl.lat,
      dialect: pl.dialectId ? dialects.get(pl.dialectId) : undefined,
      place: pl,
    };
  }
  const d = dialects.get(take.dialectId!);
  if (!d) throw new Error(`演绎 ${take.id} 指向不存在的方言：${take.dialectId}`);
  return {
    id: d.id,
    name: d.name,
    level: d.level,
    levelLabel: levelLabel(d.level),
    lng: d.lng,
    lat: d.lat,
    dialect: d,
  };
}
