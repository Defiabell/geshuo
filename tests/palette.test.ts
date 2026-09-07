import { describe, it, expect } from 'vitest';
import { colorFor, hueFor, rampStops, warmth } from '../src/lib/palette';
import { loadDialects } from '../src/lib/dialect-tree';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

/** 色相是环形的，比较距离必须绕短边 */
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** 拆 oklch(L C H)。2026-09-07 起全站输出 OKLCH——这里的角度是 Oklab 色相，
 *  跟 HSL 的度数不是一套刻度（同一个蓝：HSL 210°，OKLCH 243°）。 */
const parse = (css: string) => {
  const m = css.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error(`不是 oklch 颜色：${css}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
};

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

  // 刻度是 OKLCH：蓝在 240–270，赭红在 25–50。跟 HSL 的度数不通用。
  it('南北两端落在该有的色系里：北端偏蓝，南端偏赭', () => {
    expect(hueDist(hueFor(46), 250)).toBeLessThan(25);
    expect(hueDist(hueFor(20), 35)).toBeLessThan(25);
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
      // OKLCH 的绿大致在 120–180（纯绿 ≈142，黄 ≈110）
      expect(h < 110 || h > 185, `纬度 ${lat}° 的色相 ${h}° 落进绿区了`).toBe(true);
    }
  });

  it('中纬度也得有彩度，不能褪成灰——真人那一列正好落在这一段', () => {
    for (let lat = 28; lat <= 42; lat += 2) {
      const { c } = parse(colorFor({ lat, level: 'point' }));
      expect(c, `纬度 ${lat}° 褪成灰了`).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('层级越细彩度越高——颜色越实，和虚实语法同向', () => {
    const c = (level: 'supergroup' | 'group' | 'point') =>
      parse(colorFor({ lat: 37, level })).c;
    expect(c('point')).toBeGreaterThan(c('group'));
    expect(c('group')).toBeGreaterThan(c('supergroup'));
  });

  // 三条轴解耦：同一个方言换用途只该差明度，色相和彩度必须一模一样。
  // 上一版把明度和色相混在 HSL 里，色条最右一段总是发白，根子就在这儿。
  it('明度只由用途定，不牵动色相与彩度', () => {
    const a = parse(colorFor({ lat: 37, level: 'point' }, 0.42));
    const b = parse(colorFor({ lat: 37, level: 'point' }, 0.62));
    expect(b.l).toBeGreaterThan(a.l);
    expect(b.h).toBe(a.h);
    expect(b.c).toBe(a.c);
  });

  // 同一档明度下，全色相的感知亮度一致——这是换 OKLCH 的全部理由
  it('南北两端在同一明度上一样重', () => {
    expect(parse(colorFor({ lat: 44, level: 'point' })).l).toBe(
      parse(colorFor({ lat: 23, level: 'point' })).l,
    );
  });

  it('没有坐标的分类节点给中性墨色，不编一个位置', () => {
    expect(parse(colorFor({ lat: undefined, level: 'supergroup' })).c).toBeLessThan(0.02);
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

/**
 * 报头就是这条轴的图例（一字一色）。它不挂在具体地方上，所以只需要保证
 * 两件事：档位数对得上，方向是北→南。
 */
describe('色阶图例', () => {
  it('给几档就出几个色', () => {
    expect(rampStops(4).length).toBe(4);
    expect(rampStops(0)).toEqual([]);
  });

  it('从冷到暖，跟颜色轴同向', () => {
    const [first, , , last] = rampStops(4);
    expect(hueDist(parse(first).h, hueFor(46))).toBeLessThan(1);
    expect(hueDist(parse(last).h, hueFor(20))).toBeLessThan(1);
  });

  it('一档时取中点，不是端点', () => {
    expect(rampStops(1)[0]).not.toBe(rampStops(2)[0]);
  });
});
