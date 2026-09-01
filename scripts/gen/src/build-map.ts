import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 投影函数跟页面共用同一份——两边不一致的话方言点会飘到海里
import { LAT_K, project } from '../../../src/lib/geo';

/**
 * 把中国轮廓 GeoJSON 预先投影、简化成一条 SVG path，落进 src/data/。
 *
 * 为什么在构建期做掉、而不是运行时拉 GeoJSON：
 * - 162KB 的 GeoJSON 传给每个访客不值得，转成 path 只剩几十 KB；
 * - 运行时依赖外部接口意味着接口挂了地图就白了，而这是个纯静态站；
 * - 投影一次性算完，前端不需要任何地图库。
 *
 * 方言点和轮廓**用同一个投影**（等距圆柱 + 纬度拉伸），所以不管投影准不准，
 * 点和轮廓永远是对齐的——这是选它的关键理由，不是因为它精确。
 *
 * 数据源：阿里云 DataV 地理边界服务（国内站点的事实标准）。
 * 重新生成：pnpm gen:map
 */
const SOURCE = 'https://geo.datav.aliyun.com/areas_v3/bound/100000.json';


/** 环点数少于这个数的当噪点丢掉——保留海南、台湾等有形状的岛，去掉一堆单点礁 */
const MIN_RING_POINTS = 10;

interface GeoJson {
  features: Array<{ geometry: { type: string; coordinates: unknown } }>;
}

function ringsOf(geo: GeoJson): number[][][] {
  const out: number[][][] = [];
  for (const f of geo.features) {
    const { type, coordinates } = f.geometry;
    const polys = type === 'MultiPolygon' ? (coordinates as number[][][][]) : [coordinates as number[][][]];
    for (const poly of polys) for (const ring of poly) out.push(ring);
  }
  return out;
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`拉取轮廓失败 ${res.status}`);
  const geo = (await res.json()) as GeoJson;

  const rings = ringsOf(geo).filter((r) => r.length >= MIN_RING_POINTS);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const parts: string[] = [];

  for (const ring of rings) {
    const pts: string[] = [];
    let last = '';
    for (const [lng, lat] of ring as [number, number][]) {
      const [x, y] = project(lng, lat);
      // 保留一位小数：视觉上看不出差别，体积能小掉一多半
      const s = `${x.toFixed(1)},${y.toFixed(1)}`;
      if (s === last) continue; // 连续重复点直接丢
      last = s;
      pts.push(s);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (pts.length < 3) continue;
    parts.push(`M${pts.join('L')}Z`);
  }

  const pad = 1;
  const out = {
    source: SOURCE,
    note: '构建期预投影（等距圆柱 + 纬度拉伸 1/cos35°）。方言点必须用同一个投影，见 scripts/gen/src/build-map.ts 的 project()。',
    latK: Number(LAT_K.toFixed(6)),
    viewBox: [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].map((n) =>
      Number(n.toFixed(2)),
    ),
    path: parts.join(''),
  };

  const dest = join(fileURLToPath(new URL('../../../', import.meta.url)), 'src/data/china-outline.json');
  writeFileSync(dest, JSON.stringify(out), 'utf8');
  console.log(`✓ ${rings.length} 个环 → ${(out.path.length / 1024).toFixed(0)} KB path，viewBox ${out.viewBox.join(' ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
