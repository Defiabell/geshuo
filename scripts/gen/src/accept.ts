import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import { measureDurationMs } from './duration';
import type { Dialect, Performance } from '../../../src/lib/types';

/**
 * 把审听通过的投稿录音接进站点。
 *
 *   pnpm recordings:draft    生成 .inbox/texts.yaml —— 你在里面填「实际说了什么」
 *   pnpm recordings:accept   按那份文件建方言点、落音频、写演绎
 *
 * 为什么必须填 said：站上 textDialect 是主展示行。照搬 AI 写的那句去配真人的
 * 音，字和声对不上，正是这个项目最忌讳的"看着真、其实假"。所以草稿里 said
 * 一律留空，AI 版只作为注释摆在旁边参考，逼你有意识地写一次。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INBOX = join(ROOT, '.inbox');
const MP3 = join(INBOX, 'mp3');
const DATA_DIR = join(ROOT, 'src/data/');
const TEXTS = join(INBOX, 'texts.yaml');

interface Meta { place?: string; sceneId?: string; beatId?: string; contact?: string; note?: string }
interface Obj { key: string; custom_metadata?: Meta }

interface Draft {
  dialect: Dialect;
  contributor?: string;
  scenes: Record<string, Record<string, { intent?: string; ai?: string; said: string; note?: string }>>;
}

const shortId = (key: string) => {
  const file = key.split('/').pop() ?? key;
  return file.split('-').slice(1).join('-').replace(/\.[^.]+$/, '').slice(0, 8);
};

function manifest(): Obj[] {
  const p = join(INBOX, 'manifest.json');
  if (!existsSync(p)) throw new Error('没有 .inbox/manifest.json —— 先跑 pnpm recordings:pull');
  return JSON.parse(readFileSync(p, 'utf8')) as Obj[];
}

function aiTextFor(sceneId: string, beatId: string): string {
  const dir = join(DATA_DIR, 'performances');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml'))) {
    const p = parse(readFileSync(join(dir, f), 'utf8')) as Performance;
    if (p.sceneId !== sceneId || p.source !== 'tts' || p.dialectId !== 'jilu') continue;
    const l = p.lines.find((x) => x.beatId === beatId);
    if (l) return l.textDialect;
  }
  return '';
}

function draft() {
  const objs = manifest();
  if (objs.length === 0) { console.log('.inbox 里没有投稿。'); return; }
  const scenes = loadScenes(DATA_DIR);

  const place = objs.find((o) => o.custom_metadata?.place)?.custom_metadata?.place ?? '';
  const grouped: Record<string, string[]> = {};
  for (const o of objs) {
    const m = o.custom_metadata ?? {};
    if (!m.sceneId || !m.beatId) continue;
    (grouped[m.sceneId] ??= []).push(m.beatId);
  }

  const lines: string[] = [
    '# 把投稿录音接进站点。填好每条 said: 之后跑 pnpm recordings:accept',
    '#',
    `# 投稿地点：${place || '（没填）'}`,
    '# said 必须是"录音里实际说出口的话"。ai 那行只是参考，照抄它等于让字和声对不上。',
    '# 某一句实在听不清，把整条删掉即可——宁可少一句，不要写一句假的。',
    '',
    'dialect:',
    '  id: wucheng',
    '  name: 山东武城',
    '  level: point',
    '  parentId: jilu',
    '  lng: 116.07',
    '  lat: 37.21',
    '  description: 冀鲁官话内的具体方言点，德州市武城县。',
    '',
    "contributor: ''   # 想署名就写个称呼，留空则不署",
    '',
    'scenes:',
  ];

  for (const [sceneId, beats] of Object.entries(grouped)) {
    const scene = scenes.get(sceneId);
    const speaking = scene?.beats.filter((b) => b.speakerRole !== 'none') ?? [];
    const missing = speaking.filter((b) => !beats.includes(b.id)).map((b) => b.id);
    lines.push(`  # ${scene?.title ?? sceneId}`);
    if (missing.length) {
      lines.push(`  # ⚠ 这一场还缺 ${missing.join(' / ')}，缺拍的场景 accept 会跳过（横向对比靠逐拍对齐）`);
    }
    lines.push(`  ${sceneId}:`);
    for (const b of speaking) {
      if (!beats.includes(b.id)) continue;
      const ai = aiTextFor(sceneId, b.id);
      lines.push(`    ${b.id}:`);
      lines.push(`      intent: ${JSON.stringify(b.intent)}`);
      if (ai) lines.push(`      ai: ${JSON.stringify(ai)}`);
      lines.push(`      said: ''`);
      lines.push(`      note: ''`);
    }
    lines.push('');
  }

  writeFileSync(TEXTS, lines.join('\n'), 'utf8');
  console.log(`✓ 已生成 ${TEXTS}`);
  console.log('  填完每条 said: 之后跑 pnpm recordings:accept');
}

function accept() {
  if (!existsSync(TEXTS)) throw new Error('没有 .inbox/texts.yaml —— 先跑 pnpm recordings:draft');
  const d = parse(readFileSync(TEXTS, 'utf8')) as Draft;
  if (!d?.dialect?.id) throw new Error('texts.yaml 里缺 dialect.id');

  const scenes = loadScenes(DATA_DIR);
  const objs = manifest();
  const clipOf = (sceneId: string, beatId: string) =>
    objs.find((o) => o.custom_metadata?.sceneId === sceneId && o.custom_metadata?.beatId === beatId);

  // 1) 方言点：已有就不动（別人可能已经录过这个点）
  const dialectsPath = join(DATA_DIR, 'dialects.yaml');
  const dialects = parse(readFileSync(dialectsPath, 'utf8')) as Dialect[];
  if (!dialects.some((x) => x.id === d.dialect.id)) {
    dialects.push(d.dialect);
    writeFileSync(dialectsPath, stringify(dialects), 'utf8');
    console.log(`✓ 方言树新增 ${d.dialect.name}（${d.dialect.id}，${d.dialect.level} 级，挂在 ${d.dialect.parentId}）`);
  } else {
    console.log(`- 方言点 ${d.dialect.id} 已存在，不动`);
  }

  let made = 0;
  for (const [sceneId, beats] of Object.entries(d.scenes ?? {})) {
    const scene = scenes.get(sceneId);
    if (!scene) { console.warn(`✗ ${sceneId} 不是已知场景，跳过`); continue; }
    const speaking = scene.beats.filter((b) => b.speakerRole !== 'none');
    const filled = Object.entries(beats).filter(([, v]) => (v.said ?? '').trim() !== '');

    const missing = speaking.filter((b) => !filled.some(([id]) => id === b.id));
    if (missing.length) {
      // 缺拍的不给建——横向对比靠逐拍对齐，少一拍整列会错位，validateContent 也会拦
      console.warn(
        `- ${scene.title} 跳过：缺 ${missing.map((b) => b.id).join(' / ')}` +
          `（录了但 said 没填的也算缺）`,
      );
      continue;
    }

    const perfId = `${sceneId}.${d.dialect.id}`;
    const outDir = join(ROOT, 'public/audio', perfId);
    mkdirSync(outDir, { recursive: true });

    const perf: Performance = {
      id: perfId,
      sceneId,
      dialectId: d.dialect.id,
      source: 'human',
      verification: 'human_recorded',
      ...(d.contributor ? { contributor: d.contributor } : {}),
      lines: scene.beats.map((b) => {
        if (b.speakerRole === 'none') {
          // 空拍沿用骨架里的处理：不配音频
          return { beatId: b.id, textDialect: '——', textMandarin: '（沉默）' };
        }
        const v = beats[b.id];
        const clip = clipOf(sceneId, b.id);
        const sid = clip ? shortId(clip.key) : '';
        const src = join(MP3, `${sid}.mp3`);
        if (!sid || !existsSync(src)) throw new Error(`${perfId} 的 ${b.id} 找不到已转码的音频（${src}）`);
        const dest = join(outDir, `${b.id}.mp3`);
        copyFileSync(src, dest);
        const ms = measureDurationMs(dest);
        return {
          beatId: b.id,
          textDialect: v.said.trim(),
          textMandarin: v.note?.trim() || b.intent,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
          audio: `/audio/${perfId}/${b.id}.mp3`,
          ...(ms !== undefined ? { durationMs: ms } : {}),
        };
      }),
    };

    writeFileSync(join(DATA_DIR, 'performances', `${perfId}.yaml`), stringify(perf), 'utf8');
    console.log(`✓ ${scene.title} → ${perfId}（真人录音，${filled.length} 条）`);
    made += 1;
  }

  console.log(made > 0
    ? `\n✓ 建了 ${made} 份真人演绎。跑 pnpm test && pnpm build 校验，再 pnpm deploy。`
    : '\n没有任何一场是完整的，什么都没建。');
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'draft') return draft();
  if (cmd === 'accept') return accept();
  console.error('用法: recordings:draft | recordings:accept');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
}
