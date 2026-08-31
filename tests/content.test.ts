import { describe, it, expect } from 'vitest';
import { loadScenes, loadPerformances, validateContent, linesForBeat } from '../src/lib/content';
import { loadDialects } from '../src/lib/dialect-tree';
import type { Dialect, Performance, Scene } from '../src/lib/types';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

const scene: Scene = {
  id: 's', title: 'T', situation: 'X',
  beats: [
    { id: 'b1', order: 1, intent: 'i1', speakerRole: 'mom' },
    { id: 'b2', order: 2, intent: 'i2', speakerRole: 'kid' },
  ],
};

function perf(lines: Array<{ beatId: string }>): Performance {
  return {
    id: 'p', sceneId: 's', dialectId: 'jilu', source: 'tts', verification: 'unverified',
    lines: lines.map((l) => ({ ...l, textDialect: 'a', textMandarin: 'b' })),
  };
}

describe('loadScenes / loadPerformances', () => {
  it('读出深夜回家场景的六拍', () => {
    const scenes = loadScenes(DATA_DIR);
    expect(scenes.get('late-night')?.beats).toHaveLength(6);
  });

  it('读出冀鲁官话的演绎且标为未校对', () => {
    const ps = loadPerformances(DATA_DIR);
    const p = ps.find((x) => x.id === 'late-night.jilu');
    expect(p?.verification).toBe('unverified');
    expect(p?.source).toBe('tts');
  });
});

describe('validateContent', () => {
  const dialects = loadDialects(DATA_DIR);

  it('演绎漏了一拍就抛错', () => {
    const scenes = new Map([['s', scene]]);
    expect(() => validateContent(scenes, [perf([{ beatId: 'b1' }])], dialects))
      .toThrow(/缺少 beat: b2/);
  });

  it('演绎多出场景没有的拍也抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = perf([{ beatId: 'b1' }, { beatId: 'b2' }, { beatId: 'b9' }]);
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/未知 beat: b9/);
  });

  it('beatId 集合覆盖场景但条数不符时抛错（重复 beat 撑住 Set 去重检查）', () => {
    const scenes = new Map([['s', scene]]);
    const p = perf([{ beatId: 'b1' }, { beatId: 'b1' }, { beatId: 'b2' }]);
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/台词条数与场景拍数不符/);
  });

  it('演绎指向不存在的场景就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), sceneId: 'ghost-scene' };
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/指向不存在的场景：ghost-scene/);
  });

  it('演绎指向不存在的方言就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'ghost-dialect' };
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/指向不存在的方言：ghost-dialect/);
  });

  it('TTS 演绎挂到 point 级方言时抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'dezhou' };
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/TTS 演绎不得挂在点级\/小片级/);
  });

  it('TTS 演绎挂到 subcluster 级方言时抛错', () => {
    const scenes = new Map([['s', scene]]);
    const dialectsWithSubcluster = new Map(dialects);
    const subcluster: Dialect = {
      id: 'test-subcluster', name: '测试小片', level: 'subcluster', parentId: 'xinan',
    };
    dialectsWithSubcluster.set(subcluster.id, subcluster);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: subcluster.id };
    expect(() => validateContent(scenes, [p], dialectsWithSubcluster))
      .toThrow(/TTS 演绎不得挂在点级\/小片级/);
  });

  it('TTS 演绎挂到 cluster 级方言（成渝片）不受影响，正常放行', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'chengyu' };
    expect(() => validateContent(scenes, [p], dialects)).not.toThrow();
  });

  it('真人录音挂到 point 级是允许的', () => {
    const scenes = new Map([['s', scene]]);
    const p: Performance = {
      ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]),
      dialectId: 'dezhou', source: 'human', verification: 'human_recorded',
    };
    expect(() => validateContent(scenes, [p], dialects)).not.toThrow();
  });

  it('真实数据整体校验通过', () => {
    const scenes = loadScenes(DATA_DIR);
    const ps = loadPerformances(DATA_DIR);
    expect(() => validateContent(scenes, ps, dialects)).not.toThrow();
  });

  it('演绎的 verification 拼错/不在三档已知集合内时抛错——否则可信度标签会静默渲染成空', () => {
    const scenes = new Map([['s', scene]]);
    const p = {
      ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]),
      verification: 'unverfied' as Performance['verification'],
    };
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/verification 非法/);
  });

  it('演绎的 source 拼错/不在已知集合内时抛错——否则粒度声明条会静默消失', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), source: 'TTS' as Performance['source'] };
    expect(() => validateContent(scenes, [p], dialects)).toThrow(/source 非法/);
  });

  it('场景 beat 的 speakerRole 不在已知集合内时抛错——否则剪影会被静默调暗、TTS 情绪指令会静默清空', () => {
    const badScene: Scene = {
      id: 's3', title: 'T', situation: 'X',
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'dad' as Scene['beats'][number]['speakerRole'] }],
    };
    const scenes = new Map([['s3', badScene]]);
    expect(() => validateContent(scenes, [], dialects)).toThrow(/speakerRole 非法：dad/);
  });

  it('speakerRole 校验不依赖场景是否已有演绎——空场景骨架也要过检查', () => {
    const badScene: Scene = {
      id: 's4', title: 'T', situation: 'X',
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'grandpa' as Scene['beats'][number]['speakerRole'] }],
    };
    const scenes = new Map([['s4', badScene]]);
    // performances 为空数组，证明这条校验独立于 performances 循环
    expect(() => validateContent(scenes, [], dialects)).toThrow(/speakerRole 非法/);
  });
});

describe('linesForBeat', () => {
  it('跨演绎取出同一拍，用于横向对比', () => {
    const ps = loadPerformances(DATA_DIR);
    const got = linesForBeat(ps, 'b1');

    // 每份演绎都该贡献恰好一列，且取到的都是同一拍
    expect(got).toHaveLength(ps.length);
    for (const { line } of got) expect(line.beatId).toBe('b1');

    // 断言集合而非顺序：加新方言不该让测试红，顺序是加载实现细节
    const dialects = got.map((g) => g.performance.dialectId).sort();
    expect(dialects).toEqual([...new Set(dialects)].sort());
    expect(dialects).toContain('jilu');
  });

  it('某份演绎缺该拍时只跳过它，不影响其余列', () => {
    const ps = loadPerformances(DATA_DIR);
    const got = linesForBeat([...ps, { ...ps[0], id: 'x', lines: [] }], 'b1');
    expect(got).toHaveLength(ps.length);
  });
});
