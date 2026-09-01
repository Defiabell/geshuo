import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAT_K, project } from '../src/lib/geo';

const outline = JSON.parse(
  readFileSync(new URL('../src/data/china-outline.json', import.meta.url), 'utf8'),
) as { latK: number; viewBox: number[]; path: string };

/**
 * 轮廓是构建期用 project() 预先投影好的，页面上的方言点是渲染时才投影的。
 * 两边一旦用了不同的投影参数，点就会整体飘走——而地图看上去还是"有图有点"，
 * 不会报任何错。这几条就是钉住这件事。
 */
describe('地图投影', () => {
  it('轮廓文件里记录的 latK 必须和代码里的一致，否则点会整体飘移', () => {
    expect(outline.latK).toBeCloseTo(LAT_K, 5);
  });

  it('已知方言点投影后必须落在轮廓的 viewBox 里', () => {
    const [vx, vy, vw, vh] = outline.viewBox;
    // 德州、青岛、成都、广州、长春——五个真实坐标，跨了整张图
    for (const [lng, lat] of [
      [116.36, 37.44],
      [120.38, 36.07],
      [104.1, 30.6],
      [113.3, 23.1],
      [125.3, 43.9],
    ]) {
      const [x, y] = project(lng, lat);
      expect(x, `经度 ${lng} 落在图外`).toBeGreaterThanOrEqual(vx);
      expect(x).toBeLessThanOrEqual(vx + vw);
      expect(y, `纬度 ${lat} 落在图外`).toBeGreaterThanOrEqual(vy);
      expect(y).toBeLessThanOrEqual(vy + vh);
    }
  });

  it('纬度越高，投影后的 y 越小（越靠上）', () => {
    expect(project(116, 45)[1]).toBeLessThan(project(116, 23)[1]);
  });
});
