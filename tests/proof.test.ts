import { describe, it, expect } from 'vitest';
import { indentFor, segments } from '../src/lib/proof';
import type { Identity } from '../src/lib/identity';

const id = (over: Partial<Identity>): Identity => ({
  id: over.id ?? 'x',
  name: over.name ?? '某地',
  level: over.level ?? 'point',
  levelLabel: '县',
  ...over,
});

const DONGBEI = id({ id: 'dongbei', name: '东北官话', level: 'group', lng: 125.3, lat: 43.9 });
const WUCHENG = id({ id: '371428', name: '山东武城县', lng: 116.07, lat: 37.21 });
const CHENGYU = id({ id: 'chengyu', name: '成渝片', level: 'cluster', lng: 104.1, lat: 30.6 });
const YUE = id({ id: 'yue', name: '粤语', level: 'supergroup', lng: 113.3, lat: 23.1 });

/**
 * 色条的宽度在做断言（"粤语这句最短"）。缺时长就宁可不画——
 * 按字数估会差三倍，画一条比例编出来的色条比不画更糟。
 */
describe('色条分段', () => {
  const row = (i: Identity, ms?: number, audio = '/a.mp3') => ({
    identity: i,
    audio,
    durationMs: ms,
  });

  it('宽度用真实毫秒，标注保留一位小数', () => {
    const segs = segments([row(DONGBEI, 9600), row(YUE, 4550)]);
    expect(segs.map((s) => s.ms)).toEqual([9600, 4550]);
    // 4550ms → '4.5'：4.55 在二进制里其实是 4.5499…，toFixed 不做四舍五入到 4.6。
    // 差 0.05 秒的标注无所谓，但别让下一个人以为这里有 bug。
    expect(segs.map((s) => s.label)).toEqual(['9.6', '4.5']);
  });

  it('缺一条时长就整条不画', () => {
    expect(segments([row(DONGBEI, 9600), row(YUE, undefined)])).toEqual([]);
  });

  it('只有一条能放时不画——一色不成色条', () => {
    expect(segments([row(DONGBEI, 9600), { identity: YUE, audio: '', durationMs: 4550 }])).toEqual(
      [],
    );
  });

  it('没音频的行不占宽度', () => {
    const segs = segments([
      row(DONGBEI, 9600),
      { identity: WUCHENG, audio: '', durationMs: 1000 },
      row(YUE, 4550),
    ]);
    expect(segs.map((s) => s.key)).toEqual(['dongbei', 'yue']);
  });
});

describe('经度缩进', () => {
  it('西边靠左，东边靠右，且不出负数', () => {
    expect(indentFor(104.1)).toBeLessThan(indentFor(125.3));
    expect(indentFor(70)).toBe(0);
    expect(indentFor(140)).toBe(48);
  });

  it('没有经度就不缩进——不给未知位置编一个排布', () => {
    expect(indentFor(undefined)).toBe(0);
  });
});
