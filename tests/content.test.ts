import { describe, it, expect } from 'vitest';
import { loadScenes, loadTakes, loadPlaces, loadSite, validateContent, takesForBeat } from '../src/lib/content';
import { loadDialects } from '../src/lib/dialect-tree';
import { AGE_BANDS, AGE_LABELS } from '../src/lib/types';
import type { Dialect, Take, Scene } from '../src/lib/types';

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

function perf(lines: Array<{ beatId: string }>): Take {
  return {
    id: 'p', sceneId: 's', dialectId: 'chengyu', source: 'tts', verification: 'unverified',
    lines: lines.map((l) => ({ ...l, textDialect: 'a', textMandarin: 'b' })),
  };
}

describe('loadScenes / loadTakes', () => {
  it('读出深夜回家场景的六拍', () => {
    const scenes = loadScenes(DATA_DIR);
    expect(scenes.get('late-night')?.beats).toHaveLength(6);
  });

  it('读出东北官话的演绎且标为未校对', () => {
    const ps = loadTakes(DATA_DIR);
    const p = ps.find((x) => x.id === 'late-night.dongbei');
    expect(p?.verification).toBe('unverified');
    expect(p?.source).toBe('tts');
  });

  // 回归测试：冀鲁官话的 AI 演绎 2026-09-05 全部下线，不许悄悄回来
  it('没有任何 AI 演绎挂在冀鲁官话上', () => {
    const ps = loadTakes(DATA_DIR);
    expect(ps.filter((x) => x.dialectId === 'jilu')).toHaveLength(0);
  });
});

describe('validateContent', () => {
  const dialects = loadDialects(DATA_DIR);
  const places = loadPlaces(DATA_DIR);
  const testPlaces = new Map(places).set('999999', {
    code: '999999', name: '测试县', province: '测试省', city: '测试市', lng: 100, lat: 30,
  });

  it('演绎漏了一拍就抛错', () => {
    const scenes = new Map([['s', scene]]);
    expect(() => validateContent(scenes, [perf([{ beatId: 'b1' }])], dialects, testPlaces))
      .toThrow(/缺少 beat: b2/);
  });

  it('演绎多出场景没有的拍也抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = perf([{ beatId: 'b1' }, { beatId: 'b2' }, { beatId: 'b9' }]);
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/未知 beat: b9/);
  });

  it('同一拍出现两次就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = perf([{ beatId: 'b1' }, { beatId: 'b1' }, { beatId: 'b2' }]);
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/有重复的 beat/);
  });

  it('演绎指向不存在的场景就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), sceneId: 'ghost-scene' };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/指向不存在的场景：ghost-scene/);
  });

  it('演绎指向不存在的方言就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'ghost-dialect' };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/指向不存在的方言：ghost-dialect/);
  });

  // 点级节点 2026-09-05 已全部移出方言树（县域颗粒归 places.yaml），但层级闸留着：
  // 它挡的是「颗粒太细」，跟 noAiReason 挡的「没有标准形式」是两回事，谁要是
  // 再往树里塞一个点级节点并挂 TTS，这条会拦住。
  it('TTS 演绎挂到 point 级方言时抛错', () => {
    const scenes = new Map([['s', scene]]);
    const withPoint = new Map(dialects).set('test-point', {
      id: 'test-point', name: '测试点', level: 'point' as const, parentId: 'jilu',
    });
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'test-point' };
    expect(() => validateContent(scenes, [p], withPoint, testPlaces)).toThrow(/TTS 演绎不得挂在点级\/小片级/);
  });

  it('TTS 演绎挂到 subcluster 级方言时抛错', () => {
    const scenes = new Map([['s', scene]]);
    const dialectsWithSubcluster = new Map(dialects);
    const subcluster: Dialect = {
      id: 'test-subcluster', name: '测试小片', level: 'subcluster', parentId: 'xinan',
    };
    dialectsWithSubcluster.set(subcluster.id, subcluster);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: subcluster.id };
    expect(() => validateContent(scenes, [p], dialectsWithSubcluster, testPlaces))
      .toThrow(/TTS 演绎不得挂在点级\/小片级/);
  });

  it('TTS 演绎挂到 cluster 级方言（成渝片）不受影响，正常放行', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), dialectId: 'chengyu' };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).not.toThrow();
  });

  it('真人贡献挂 placeCode 放行，并且可以只录一部分拍', () => {
    const scenes = new Map([['s', scene]]);
    const { dialectId: _drop, ...rest } = perf([{ beatId: 'b1' }]);
    const p: Take = {
      ...rest, placeCode: '999999', source: 'human', verification: 'human_recorded',
    };
    // 只录了 b1、没录 b2——旧模型会判「缺少 beat」，新模型读作「已认领一半」
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).not.toThrow();
  });

  it('身份两个都给就抛错——一条录音不能同时代表一个县和整个方言区', () => {
    const scenes = new Map([['s', scene]]);
    const p: Take = {
      ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]),
      placeCode: '999999', source: 'human', verification: 'human_recorded',
    };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/身份必须二选一/);
  });

  it('真人贡献挂 dialectId 就抛错——人永远来自某个具体的县，不替整个区代言', () => {
    const scenes = new Map([['s', scene]]);
    const p: Take = {
      ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]),
      source: 'human', verification: 'human_recorded',
    };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/必须挂 placeCode/);
  });

  it('placeCode 没在 places.yaml 登记就抛错', () => {
    const scenes = new Map([['s', scene]]);
    const { dialectId: _drop, ...rest } = perf([{ beatId: 'b1' }]);
    const p: Take = {
      ...rest, placeCode: '000000', source: 'human', verification: 'human_recorded',
    };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/未登记的行政区划/);
  });

  it('AI 演绎缺拍仍然抛错——它是批量生成的，缺一拍就是生成失败', () => {
    const scenes = new Map([['s', scene]]);
    expect(() => validateContent(scenes, [perf([{ beatId: 'b1' }])], dialects, testPlaces))
      .toThrow(/缺少 beat: b2/);
  });

  it('真实数据整体校验通过', () => {
    expect(() => loadSite(DATA_DIR)).not.toThrow();
  });

  it('演绎的 verification 拼错/不在三档已知集合内时抛错——否则可信度标签会静默渲染成空', () => {
    const scenes = new Map([['s', scene]]);
    const p = {
      ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]),
      verification: 'unverfied' as Take['verification'],
    };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/verification 非法/);
  });

  it('演绎的 source 拼错/不在已知集合内时抛错——否则粒度声明条会静默消失', () => {
    const scenes = new Map([['s', scene]]);
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), source: 'TTS' as Take['source'] };
    expect(() => validateContent(scenes, [p], dialects, testPlaces)).toThrow(/source 非法/);
  });

  it('beat 用了 roles 里没声明的角色时抛错——否则合成时查不到声色和情绪，出来一个用错嗓子的版本而页面看不出异常', () => {
    const badScene: Scene = {
      id: 's3', title: 'T', situation: 'X',
      roles: { mom: { name: '妈妈', voice: 'adult_female' } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'dad' }],
    };
    const scenes = new Map([['s3', badScene]]);
    expect(() => validateContent(scenes, [], dialects, testPlaces)).toThrow(/speakerRole 非法：dad/);
  });

  it('speakerRole 校验不依赖场景是否已有演绎——空场景骨架也要过检查', () => {
    const badScene: Scene = {
      id: 's4', title: 'T', situation: 'X',
      roles: {},
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'grandpa' }],
    };
    const scenes = new Map([['s4', badScene]]);
    // takes 为空数组，证明这条校验独立于 takes 循环
    expect(() => validateContent(scenes, [], dialects, testPlaces)).toThrow(/speakerRole 非法/);
  });

  it('角色的 voice 不是合法声色档位时抛错——不能等到合成时才炸，那时已经花过钱了', () => {
    const badScene: Scene = {
      id: 's5', title: 'T', situation: 'X',
      roles: { mom: { name: '妈妈', voice: 'grandma' as Scene['roles'][string]['voice'] } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'mom' }],
    };
    expect(() => validateContent(new Map([['s5', badScene]]), [], dialects, new Map())).toThrow(/voice 非法/);
  });

  it("'none' 是空拍保留值，不能拿来当角色名", () => {
    const badScene: Scene = {
      id: 's6', title: 'T', situation: 'X',
      roles: { none: { name: '无', voice: 'adult_male' } },
      beats: [{ id: 'b1', order: 1, intent: 'i1', speakerRole: 'none' }],
    };
    expect(() => validateContent(new Map([['s6', badScene]]), [], dialects, new Map())).toThrow(/空拍保留值/);
  });
});

describe('代际轴', () => {
  const dialects = loadDialects(DATA_DIR);
  const places = loadPlaces(DATA_DIR);

  // age 拼错会让这根轴静默失效：标签渲染成空，而页面上看不出任何异常。
  // 跟 verification / source / transcript 是同一类问题——能被悄悄关掉的标注
  // 必须在构建期炸掉。
  it('age 拼错就抛错，不许静默渲染成空', () => {
    const p = { ...perf([{ beatId: 'b1' }, { beatId: 'b2' }]), age: '八零后' as never };
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects, places))
      .toThrow(/age 非法/);
  });

  it('不填 age 是合法的——问年龄本身就是门槛，不能因为一根轴把人挡在外面', () => {
    const p = perf([{ beatId: 'b1' }, { beatId: 'b2' }]);
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects, places)).not.toThrow();
  });

  it('五个代际标签都有中文名，渲染不出 undefined', () => {
    for (const b of AGE_BANDS) expect(AGE_LABELS[b]).toBeTruthy();
  });
});

describe('noAiReason：没有标准形式的方言禁止挂 AI 演绎', () => {
  const noAiPlaces = new Map([
    ['999999', { code: '999999', name: '测试县', province: '测试省', city: '测试市', lng: 100, lat: 30, dialectId: 'x' }],
  ]);
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
    const p: Take = {
      id: 'p', sceneId: 's', dialectId: 'x', source: 'tts', verification: 'unverified',
      lines: scene.beats.map((b) => ({ beatId: b.id, textDialect: 'a', textMandarin: 'b' })),
    };
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects, noAiPlaces))
      .toThrow(/禁止 AI 生成/);
  });

  // 真人不受这道闸限制——恰恰相反，标了 noAiReason 的地方**只能**靠真人。
  // 注意真人挂的是 placeCode（某个县），不是 dialectId（整个区）：这个县的
  // 方言归属注释着 x，但代言的只是这个县自己。
  it('同一片区里的真人贡献照常放行', () => {
    const dialects = new Map<string, Dialect>([
      ['x', { id: 'x', name: '某区', level: 'group', parentId: null, noAiReason: '没有标准形式' }],
    ]);
    const p: Take = {
      id: 'p', sceneId: 's', placeCode: '999999', source: 'human', verification: 'human_recorded',
      lines: scene.beats.map((b) => ({ beatId: b.id, textDialect: 'a', textMandarin: 'b' })),
    };
    expect(() => validateContent(new Map([['s', scene]]), [p], dialects, noAiPlaces)).not.toThrow();
  });

  // 真实数据上的守卫：冀鲁和胶辽都必须带着理由，理由本身要显示在页面上
  it('冀鲁与胶辽在真实数据里都标了理由', () => {
    const ds = loadDialects(DATA_DIR);
    for (const id of ['jilu', 'jiaoliao']) {
      expect(ds.get(id)?.noAiReason, `${id} 缺 noAiReason`).toBeTruthy();
    }
  });
});

describe('takesForBeat', () => {
  it('跨演绎取出同一拍，用于横向对比', () => {
    const ps = loadTakes(DATA_DIR);
    const forScene = ps.filter((p) => p.sceneId === 'late-night');
    const got = takesForBeat(ps, 'late-night', 'b1');

    // 这一场的每份演绎都该贡献恰好一列，且取到的都是同一拍
    expect(got).toHaveLength(forScene.length);
    for (const { line } of got) expect(line.beatId).toBe('b1');

    // 断言集合而非顺序：加新方言不该让测试红，顺序是加载实现细节
    const dialects = got.map((g) => g.take.dialectId).sort();
    expect(dialects).toEqual([...new Set(dialects)].sort());
    expect(dialects).toContain('dongbei');
  });

  // 回归测试：三个场景都用 b1..b6 做拍号，只按 beatId 匹配会把「上门要债」
  // 的台词混进「深夜回家」的对比页——签名里的 sceneId 就是为了堵这个。
  it('不同场景的同名拍号绝不能互相串台', () => {
    const ps = loadTakes(DATA_DIR);
    const got = takesForBeat(ps, 'late-night', 'b1');
    for (const { take } of got) expect(take.sceneId).toBe('late-night');

    const other = takesForBeat(ps, 'debt', 'b1');
    for (const { take } of other) expect(take.sceneId).toBe('debt');

    // 两边都不为空，否则这条测试等于什么都没验
    expect(got.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
  });

  it('某份演绎缺该拍时只跳过它，不影响其余列', () => {
    const ps = loadTakes(DATA_DIR);
    const forScene = ps.filter((p) => p.sceneId === 'late-night');
    const got = takesForBeat([...ps, { ...forScene[0], id: 'x', lines: [] }], 'late-night', 'b1');
    expect(got).toHaveLength(forScene.length);
  });
});
