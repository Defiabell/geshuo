import { describe, it, expect } from 'vitest';
import { loadScenes, loadPerformances, validateContent, linesForBeat } from '../src/lib/content';
import { loadDialects } from '../src/lib/dialect-tree';
import type { Dialect, Performance, Scene } from '../src/lib/types';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

const scene: Scene = {
  id: 's', title: 'T', situation: 'X',
  roles: {
    mom: { name: '妈妈', voice: 'adult_female', mood: '生气' },
    kid: { name: '孩子', voice: 'adult_male', mood: '敷衍' },
  },
  beats: [
    { id: 'b1', order: 1, intent: 'i1', speakerRole: 'mom' },
    { id: 'b2', order: 2, intent: 'i2', speakerRole: 'kid' },
  ],
};

function perf(lines: Array<{ beatId: string }>): Performance {
  return {
    id: 'p', sceneId: 's', dialectId: 'chengyu', source: 'tts', verification: 'unverified',
    lines: lines.map((l) => ({ ...l, textDialect: 'a', textMandarin: 'b' })),
  };
}

describe('loadScenes / loadPerformances', () => {
  it('读出深夜回家场景的六拍', () => {
    const scenes = loadScenes(DATA_DIR);
    expect(scenes.get('late-night')?.beats).toHaveLength(6);
  });

  it('读出东北官话的演绎且标为未校对', () => {
    const ps = loadPerformances(DATA_DIR);
    const p = ps.find((x) => x.id === 'late-night.dongbei');
    expect(p?.verification).toBe('unverified');
    expect(p?.source).toBe('tts');
  });

  // 回归测试：冀鲁官话的 AI 演绎 2026-09-05 全部下线，不许悄悄回来
  it('没有任何 AI 演绎挂在冀鲁官话上', () => {
    const ps = loadPerformances(DATA_DIR);
    expect(ps.filter((x) => x.dialectId === 'jilu')).toHaveLength(0);
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

  it('beat 用了 roles 里没声明的角色时抛错——否则合成时查不到声色和情绪，出来一个用错嗓子的版本而页面看不出异常', () => {
    const badScene: Scene = {
      id: 's3', title: 'T', situation: 'X',
      roles: { mom: { name: '妈妈', voice: 'adult_female' } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'dad' }],
    };
    const scenes = new Map([['s3', badScene]]);
    expect(() => validateContent(scenes, [], dialects)).toThrow(/speakerRole 非法：dad/);
  });

  it('speakerRole 校验不依赖场景是否已有演绎——空场景骨架也要过检查', () => {
    const badScene: Scene = {
      id: 's4', title: 'T', situation: 'X',
      roles: {},
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'grandpa' }],
    };
    const scenes = new Map([['s4', badScene]]);
    // performances 为空数组，证明这条校验独立于 performances 循环
    expect(() => validateContent(scenes, [], dialects)).toThrow(/speakerRole 非法/);
  });

  it('角色的 voice 不是合法声色档位时抛错——不能等到合成时才炸，那时已经花过钱了', () => {
    const badScene: Scene = {
      id: 's5', title: 'T', situation: 'X',
      roles: { mom: { name: '妈妈', voice: 'grandma' as Scene['roles'][string]['voice'] } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'mom' }],
    };
    expect(() => validateContent(new Map([['s5', badScene]]), [], dialects)).toThrow(/voice 非法/);
  });

  it("'none' 是空拍保留值，不能拿来当角色名", () => {
    const badScene: Scene = {
      id: 's6', title: 'T', situation: 'X',
      roles: { none: { name: '无', voice: 'adult_male' } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'none' }],
    };
    expect(() => validateContent(new Map([['s6', badScene]]), [], dialects)).toThrow(/空拍保留值/);
  });
});

describe('noAiReason：没有标准形式的方言禁止挂 AI 演绎', () => {
  // 这一条钉住的是 2026-09-05 的教训。原先的闸门只看层级（point/subcluster
  // 禁 TTS），于是区级的冀鲁官话畅通无阻——但它是一个**分类**，不是任何人说
  // 的一种话，模型只能把济南、胶东、天津的碎片拼一起。武城母语者一听「几乎
  // 都不对」。
  //
  // 所以真正的分界不是层级，是有没有事实标准形式。层级闸留着（它挡的是另
  // 一回事：颗粒太细），noAiReason 是并列的第二道闸。
  it('区级方言只要标了 noAiReason，挂 TTS 演绎就抛错', () => {
    const dialects = new Map<string, Dialect>([
      ['x', { id: 'x', name: '某区', level: 'group', parentId: null, noAiReason: '没有标准形式' }],
    ]);
    const p: Performance = {
      id: 'p', sceneId: 's', dialectId: 'x', source: 'tts', verification: 'unverified',
      lines: scene.beats.map((b) => ({ beatId: b.id, textDialect: 'a', textMandarin: 'b' })),
    };
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects))
      .toThrow(/禁止 AI 生成/);
  });

  // 真人录音不受这道闸限制——恰恰相反，标了 noAiReason 的地方**只能**靠真人
  it('同一个方言挂真人录音则放行', () => {
    const dialects = new Map<string, Dialect>([
      ['x', { id: 'x', name: '某区', level: 'group', parentId: null, noAiReason: '没有标准形式' }],
    ]);
    const p: Performance = {
      id: 'p', sceneId: 's', dialectId: 'x', source: 'human', verification: 'human_recorded',
      lines: scene.beats.map((b) => ({ beatId: b.id, textDialect: 'a', textMandarin: 'b' })),
    };
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects)).not.toThrow();
  });

  // 真实数据上的守卫：冀鲁和胶辽都必须带着理由，理由本身要显示在页面上
  it('冀鲁与胶辽在真实数据里都标了理由', () => {
    const ds = loadDialects(DATA_DIR);
    for (const id of ['jilu', 'jiaoliao']) {
      expect(ds.get(id)?.noAiReason, `${id} 缺 noAiReason`).toBeTruthy();
    }
  });
});

describe('linesForBeat', () => {
  it('跨演绎取出同一拍，用于横向对比', () => {
    const ps = loadPerformances(DATA_DIR);
    const forScene = ps.filter((p) => p.sceneId === 'late-night');
    const got = linesForBeat(ps, 'late-night', 'b1');

    // 这一场的每份演绎都该贡献恰好一列，且取到的都是同一拍
    expect(got).toHaveLength(forScene.length);
    for (const { line } of got) expect(line.beatId).toBe('b1');

    // 断言集合而非顺序：加新方言不该让测试红，顺序是加载实现细节
    const dialects = got.map((g) => g.performance.dialectId).sort();
    expect(dialects).toEqual([...new Set(dialects)].sort());
    expect(dialects).toContain('dongbei');
  });

  // 回归测试：三个场景都用 b1..b6 做拍号，只按 beatId 匹配会把「上门要债」
  // 的台词混进「深夜回家」的对比页——签名里的 sceneId 就是为了堵这个。
  it('不同场景的同名拍号绝不能互相串台', () => {
    const ps = loadPerformances(DATA_DIR);
    const got = linesForBeat(ps, 'late-night', 'b1');
    for (const { performance } of got) expect(performance.sceneId).toBe('late-night');

    const other = linesForBeat(ps, 'debt', 'b1');
    for (const { performance } of other) expect(performance.sceneId).toBe('debt');

    // 两边都不为空，否则这条测试等于什么都没验
    expect(got.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
  });

  it('某份演绎缺该拍时只跳过它，不影响其余列', () => {
    const ps = loadPerformances(DATA_DIR);
    const forScene = ps.filter((p) => p.sceneId === 'late-night');
    const got = linesForBeat([...ps, { ...forScene[0], id: 'x', lines: [] }], 'late-night', 'b1');
    expect(got).toHaveLength(forScene.length);
  });
});
