import { describe, it, expect } from 'vitest';
import { colorFor, hueFor, warmth } from '../src/lib/palette';
import { loadDialects } from '../src/lib/dialect-tree';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

/** 色相是环形的，比较距离必须绕短边 */
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * 颜色是「这条离真实有多近」的视觉表达，不是装饰。这几条钉住那个含义，
 * 免得以后有人随手把某个方言改成好看的颜色，把地理关系搞乱。
 */
describe('方言配色', () => {
  // 冷暖是这条轴的真正不变量。色相不是——色阶要绕过绿色，必然在 360° 处
  // 回绕，「色相单调递减」这条旧断言从此不成立，也不该成立。
  it('越往北越冷，越往南越暖', () => {
    expect(warmth(44)).toBeLessThan(warmth(37));
    expect(warmth(37)).toBeLessThan(warmth(23));
  });

  it('南北两端落在该有的色系里：北端偏蓝，南端偏赭', () => {
    expect(hueDist(hueFor(46), 215)).toBeLessThan(40);
    expect(hueDist(hueFor(20), 20)).toBeLessThan(40);
  });

  it('超出南北端的纬度不会溢出色阶', () => {
    expect(hueFor(60)).toBe(hueFor(46));
    expect(hueFor(5)).toBe(hueFor(20));
  });

  // 这一条钉住 2026-09-06 的教训：上一版把纬度线性映到 HSL 色相 206°→18°，
  // 而中国的方言几乎全在 23–44°N，映过去正好落在色相环的绿色段。四列渲染
  // 出来是「三个绿加一个褐」，南北完全读不出来。
  //
  // 第二版改成两端色 RGB 直插，中点掉进灰区——中纬度渲染成灰，比绿更糟。
  // 所以最终是一条手挑的色阶，这条测试守着它不许再滑回绿。
  it('没有任何纬度落进绿色区间——中纬度是这条轴最容易翻车的地方', () => {
    for (let lat = 18; lat <= 50; lat += 1) {
      const h = hueFor(lat);
      expect(h < 75 || h > 165, `纬度 ${lat}° 的色相 ${h}° 落进绿区了`).toBe(true);
    }
  });

  it('中纬度也得有彩度，不能褪成灰——真人那一列正好落在这一段', () => {
    for (let lat = 28; lat <= 42; lat += 2) {
      const sat = Number(colorFor({ lat, level: 'point' }).match(/hsl\(\d+ (\d+)%/)![1]);
      expect(sat, `纬度 ${lat}° 褪成灰了`).toBeGreaterThanOrEqual(15);
    }
  });

  it('层级越细饱和度越高——颜色越实，和虚实语法同向', () => {
    const sat = (level: 'supergroup' | 'group' | 'point') =>
      Number(colorFor({ lat: 37, level }).match(/hsl\(\d+ (\d+)%/)![1]);
    expect(sat('point')).toBeGreaterThan(sat('group'));
    expect(sat('group')).toBeGreaterThan(sat('supergroup'));
  });

  it('没有坐标的分类节点给中性墨色，不编一个位置', () => {
    expect(colorFor({ lat: undefined, level: 'supergroup' })).toContain('8%');
  });

  it('真实数据里，同场对比的方言两两可辨（绕环色相至少差 24 度）', () => {
    const ds = loadDialects(DATA_DIR);
    const shown = ['chengyu', 'dongbei', 'jilu', 'yue']
      .map((id) => ds.get(id)!)
      .filter((d) => d.lat !== undefined)
      .map((d) => hueFor(d.lat!));
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        expect(hueDist(shown[i], shown[j]), `第 ${i} 和第 ${j} 个方言颜色太接近`)
          .toBeGreaterThanOrEqual(24);
      }
    }
  });
});
