import { describe, it, expect } from 'vitest';
import { colorFor, hueFor } from '../src/lib/palette';
import { loadDialects } from '../src/lib/dialect-tree';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

/**
 * 颜色是「这条离真实有多近」的视觉表达，不是装饰。这几条钉住那个含义，
 * 免得以后有人随手把某个方言的颜色改成好看的红色，把地理关系搞乱。
 */
describe('方言配色', () => {
  it('越往北色相越冷，越往南越暖', () => {
    expect(hueFor(44)).toBeGreaterThan(hueFor(37));
    expect(hueFor(37)).toBeGreaterThan(hueFor(23));
  });

  it('超出南北端的纬度不会溢出色相区间', () => {
    expect(hueFor(60)).toBe(hueFor(46));
    expect(hueFor(5)).toBe(hueFor(20));
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

  it('真实数据里，同一场对比的方言颜色两两可辨（色相至少差 12 度）', () => {
    const ds = loadDialects(DATA_DIR);
    const shown = ['chengyu', 'dongbei', 'jilu', 'yue']
      .map((id) => ds.get(id)!)
      .filter((d) => d.lat !== undefined)
      .map((d) => hueFor(d.lat!));
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        expect(Math.abs(shown[i] - shown[j]), `第 ${i} 和第 ${j} 个方言颜色太接近`)
          .toBeGreaterThanOrEqual(12);
      }
    }
  });
});
