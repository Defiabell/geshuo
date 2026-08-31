import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Scene } from '../../../src/lib/types';

export interface Lexicon {
  dialectId: string;
  pronouns: string[];
  particles: string[];
  verbs: Array<{ dialect: string; mandarin: string }>;
  curses: string[];
  forbidden: string[];
}

export function loadLexicon(dir: string, dialectId: string): Lexicon {
  const path = join(dir, `${dialectId}.yaml`);
  if (!existsSync(path)) throw new Error(`词表不存在：${dialectId}`);
  return parse(readFileSync(path, 'utf8')) as Lexicon;
}

export function buildPrompt(scene: Scene, lex: Lexicon): string {
  const sortedBeats = scene.beats.slice().sort((a, b) => a.order - b.order);
  const beats = sortedBeats
    .map((b) => `${b.order}. [id=${b.id}] [${b.speakerRole}] ${b.intent}`)
    .join('\n');

  const verbs = lex.verbs.map((v) => `${v.dialect}（＝${v.mandarin}）`).join('、');
  // 换一套 beat 命名法的场景，id 不一定等于 order（例：kickoff/wrapup），
  // 输出格式示例必须引用真实 id，硬编码 "b1" 只在恰好用 b1..bN 命名时凑巧对得上。
  const exampleBeatId = sortedBeats[0]?.id ?? 'beat-id';

  // 四类约束（人称/语气词/说法/骂人话）各自对应的词表数组可能为空
  // （如 chengyu 没收到把握大的代词），空数组时整行跳过，不留半截指令。
  const constraints = [
    lex.pronouns.length > 0 ? `- 人称用：${lex.pronouns.join('、')}` : null,
    lex.particles.length > 0 ? `- 语气词可用：${lex.particles.join('、')}` : null,
    lex.verbs.length > 0 ? `- 尽量用这些说法：${verbs}` : null,
    lex.curses.length > 0 ? `- 骂人的话参考：${lex.curses.join('、')}` : null,
    lex.forbidden.length > 0
      ? `- 绝对不要出现这些别的方言的词：${lex.forbidden.join('、')}`
      : null,
  ].filter((line): line is string => line !== null);

  return [
    `你在为方言剧场写台词。场景：${scene.title}——${scene.situation}`,
    '',
    `请按下面 ${scene.beats.length} 拍逐条写，每拍一句，不要合并也不要拆分：`,
    beats,
    '',
    '必须遵守：',
    ...constraints,
    '',
    '写口语，不写书面语。允许语序与普通话不同。',
    `输出 JSON 数组，每项形如 {"beatId":"${exampleBeatId}","textDialect":"...","textMandarin":"...","note":"..."}。`,
    'note 用一句话解释这句里的地方说法，没有就留空字符串。',
  ].join('\n');
}

/**
 * 逐条审计每一句台词。粒度必须是单句，不能把全稿 join 后整体判断——
 * 那样只要六拍里任意一拍命中任意一个词，就会放过「普通话骨架+几个方言词
 * 点缀」的塑料稿（这正是本函数要防的退化形态）。
 *
 * 调用方负责按需过滤掉不该审计的拍（例如空拍/沉默拍），本函数不了解
 * beat 语义。
 */
export function auditDraft(texts: string[], lex: Lexicon): string[] {
  const issues: string[] = [];

  const vocabulary = [
    ...lex.pronouns,
    ...lex.particles,
    ...lex.verbs.map((v) => v.dialect),
    ...lex.curses,
  ];

  texts.forEach((text, i) => {
    const lineNo = i + 1;

    const usedAny = vocabulary.some((w) => text.includes(w));
    if (!usedAny) {
      issues.push(`第${lineNo}句未使用任何词表词条——这多半是普通话，不是方言`);
    }

    for (const bad of lex.forbidden) {
      if (text.includes(bad)) {
        issues.push(`第${lineNo}句出现禁用词「${bad}」——那是别的方言区的说法`);
      }
    }
  });

  return issues;
}
