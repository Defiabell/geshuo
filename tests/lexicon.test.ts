import { describe, it, expect } from 'vitest';
import { loadLexicon, buildPrompt, auditDraft } from '../scripts/gen/src/lexicon';
import { loadScenes } from '../src/lib/content';
import type { Scene } from '../src/lib/types';

const LEX_DIR = new URL('../scripts/gen/lexicons/', import.meta.url).pathname;
const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

describe('loadLexicon', () => {
  it('读出冀鲁官话词表', () => {
    const lex = loadLexicon(LEX_DIR, 'jilu');
    expect(lex.pronouns).toContain('恁');
    expect(lex.verbs.some((v) => v.dialect === '家来')).toBe(true);
  });

  it('方言不存在时抛错', () => {
    expect(() => loadLexicon(LEX_DIR, 'nonexistent')).toThrow(/词表不存在/);
  });
});

describe('buildPrompt', () => {
  it('把骨架的每一拍和词表都写进 prompt', () => {
    const lex = loadLexicon(LEX_DIR, 'jilu');
    const scene = loadScenes(DATA_DIR).get('late-night')!;
    const prompt = buildPrompt(scene, lex);
    expect(prompt).toContain('妈妈质问几点了');
    expect(prompt).toContain('恁');
    expect(prompt).toContain('家来');
    expect(prompt).toContain('侬');           // 禁用词也要写进去
    expect(prompt).toContain(String(scene.beats.length));
  });

  it('用真实 beat.id 而非 order 序号——换一套命名法的场景也不能巧合对上', () => {
    const scene: Scene = {
      id: 'test-scene',
      title: '测试场景',
      situation: '测试用',
      roles: {
        mom: { name: '妈妈', voice: 'adult_female' },
        kid: { name: '孩子', voice: 'adult_male' },
      },
      beats: [
        { id: 'kickoff', order: 1, intent: '开场白', speakerRole: 'mom' },
        { id: 'wrapup', order: 2, intent: '收尾', speakerRole: 'kid' },
      ],
    };
    const lex = loadLexicon(LEX_DIR, 'jilu');
    const prompt = buildPrompt(scene, lex);
    // 拍列表里要出现真实 id
    expect(prompt).toContain('kickoff');
    expect(prompt).toContain('wrapup');
    // 输出格式示例要引用真实的第一个 beat id，不能硬编码 "b1"
    expect(prompt).toContain('"beatId":"kickoff"');
    expect(prompt).not.toContain('"beatId":"b1"');
  });

  it('chengyu 词表 pronouns 为空数组时，人称用一行整行跳过，不留半截指令', () => {
    const lex = loadLexicon(LEX_DIR, 'chengyu');
    const scene = loadScenes(DATA_DIR).get('late-night')!;
    const prompt = buildPrompt(scene, lex);
    expect(lex.pronouns).toEqual([]);
    expect(prompt).not.toContain('人称用：');
    // 非空的几类约束仍然要正常出现
    expect(prompt).toContain('语气词可用：');
    expect(prompt).toContain('晓得');
    expect(prompt).toContain('骂人的话参考：');
  });
});

describe('auditDraft', () => {
  const lex = loadLexicon(LEX_DIR, 'jilu');

  it('一个方言词都没用的稿子——两句都被逐条点名', () => {
    const issues = auditDraft(['这都几点了才回家？', '我加班呢。'], lex);
    expect(issues).toEqual([
      '第1句未使用任何词表词条——这多半是普通话，不是方言',
      '第2句未使用任何词表词条——这多半是普通话，不是方言',
    ]);
  });

  it('用了禁用词要点名具体是第几句', () => {
    const issues = auditDraft(['恁多咱家来？', '我晓得了。'], lex);
    expect(issues.join()).toMatch(/第2句出现禁用词「晓得」/);
  });

  it('正常稿子零问题', () => {
    const issues = auditDraft(['这都多咱了才家来？', '恁别管我。'], lex);
    expect(issues).toEqual([]);
  });

  it('骂人话本身就算词表词条——只用骂人话不该被判普通话', () => {
    const issues = auditDraft(['我看你能耐！'], lex);
    expect(issues).toEqual([]);
  });

  it('部分退化：六句里只有一句用了方言词，另外五句要被逐一揪出', () => {
    const texts = [
      '这都几点了才回家？',       // 普通话
      '我加班呢。',               // 普通话
      '上次你也说加班。',         // 普通话
      '你还查我的岗啊？',         // 普通话
      '行，恁以后别回家了！',     // 含方言词「恁」
      '没人说话。',               // 普通话
    ];
    const issues = auditDraft(texts, lex);
    const flaggedLines = issues
      .filter((i) => i.includes('未使用任何词表词条'))
      .map((i) => Number(i.match(/^第(\d+)句/)?.[1]));
    expect(flaggedLines).toEqual([1, 2, 3, 4, 6]);
  });
});
