import type { APIRoute } from 'astro';
import { join } from 'node:path';
import { loadSite } from '../lib/content';
import { identityOf } from '../lib/identity';
import { weeklySchedule } from '../lib/weekly';
import { SITE_NAME, SITE_URL } from '../lib/seo';

// /llms.txt (llmstxt.org): the plain-text index AI crawlers read instead of
// playing the audio. Built from the same yaml the pages are built from, at
// build time, so it cannot drift from the site. Every scene and every take
// is listed; the weekly one-line challenges are grouped on their own.
export const GET: APIRoute = async () => {
  const abs = (path: string) => new URL(path, SITE_URL).href;
  const { scenes, takes, dialects, places } = loadSite(join(process.cwd(), 'src', 'data'));
  const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

  const sceneLines = (sceneId: string) =>
    takes
      .filter((t) => t.sceneId === sceneId)
      .map((t) => ({ take: t, identity: identityOf(t, dialects, places) }))
      .sort((a, b) => (b.identity.lat ?? -90) - (a.identity.lat ?? -90))
      .map(({ take, identity }) => {
        const who = take.source === 'human'
          ? `真人录音${take.contributor ? `（${take.contributor}）` : ''}`
          : `AI 合成语音，${identity.levelLabel}级腔调`;
        return `- [${identity.name}](${abs(`/s/${sceneId}/${identity.id}/`)}): ${who}，${take.lines.length} 拍`;
      });

  const all = [...scenes.values()];
  const plays = all.filter((s) => !s.weekly);
  const { current, past } = weeklySchedule(all);
  const weeklies = current ? [current, ...past] : past;

  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    '> 方言场景剧场：同一出戏，各地各演一遍。每场戏只定骨架（谁、在什么情形下、每一拍想说什么），措辞由各地方言自便，所以同一拍可以在粤语、东北话、成渝话和真人录的县城口音之间横着听。AI 合成的演绎只到方言区一级并明确标注；真人录音挂具体县，字是大意、音是证据。',
    '',
    '作者：Jinkun Sun（Defiabell）· https://defiabell.com/ · https://github.com/Defiabell',
    `站点：${SITE_URL}`,
    '语言：中文（各地方言）',
    '',
    '## 怎么用',
    '',
    '- 每场戏一页一个方言版本，页内可从头连播；「横着听」把同一拍的各地版本并排。',
    '- 页面标注三档可信度：AI 未校对、AI 经母语者校对、真人录音；AI 不会假装是某个县的人。',
    '- 「一句话挑战」每期一句全国人都说过的话，录一句十五秒就能参与。',
    '- 「盲听猜方言」不给标签放一段让你猜；「方言地图」上 AI 是一团光晕，真人录音才是一个点。',
    '- 「录一段」：挑一场戏用自己的方言说一遍，写一句或录一段都算，不用注册；投稿只在本地人工审听后发布。',
    '',
    '## 栏目',
    '',
    `- [一句话挑战](${abs('/weekly/')}): 每期一句，看各地怎么说`,
    `- [盲听猜方言](${abs('/guess/')}): 放一段，猜是哪儿的`,
    `- [方言地图](${abs('/map/')}): 投稿越多越清楚的一张图`,
    `- [脏话也是方言](${abs('/swearing/')}): 为什么记录粗口，以及一场存废投票`,
    `- [录一段](${abs('/record/')}): 挑一场戏，用你的方言说一遍`,
    `- [来纠正](${abs('/contribute/')}): 听出不对的地方，告诉我们`,
    `- [自己出一场](${abs('/propose/')}): 你们那儿真会吵的架，你来出题`,
  ];

  lines.push('', `## 戏（${plays.length} 场）`);
  for (const scene of plays) {
    lines.push('', `### ${scene.title}`, '', oneLine(scene.situation), '');
    lines.push(...sceneLines(scene.id));
    if (scene.beats[0]) lines.push(`- [横着听第一拍](${abs(`/s/${scene.id}/compare/${scene.beats[0].id}/`)}): 同一拍，各地并排`);
    lines.push(`- [录这一场](${abs(`/record/${scene.id}/`)}): 用你的方言说一遍`);
  }

  if (weeklies.length > 0) {
    lines.push('', `## 一句话挑战（${weeklies.length} 期）`);
    for (const scene of weeklies) {
      lines.push('', `### ${scene.weekly} · ${scene.title}`, '', oneLine(scene.situation), '');
      lines.push(...sceneLines(scene.id));
    }
  }

  lines.push('', '## 同作者', '', '- [defiabell.com](https://defiabell.com/): 个人项目门户', '');
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
