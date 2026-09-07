import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import { measureDurationMs } from './duration';
import type { AgeBand, Place, Take } from '../../../src/lib/types';

/**
 * 把审听通过的投稿录音接进站点。
 *
 *   pnpm recordings:draft    生成 .inbox/texts.yaml —— 你在里面填「实际说了什么」
 *   pnpm recordings:accept   按那份文件建方言点、落音频、写演绎
 *
 * 关于 said：站上 textDialect 是主展示行，所以它必须**经过投稿人本人过目**。
 * 但不要求逐字转写——很多方言词没有通行写法，只能拿同音字凑，逼人逐字写等于
 * 把门槛抬回没人进得来。真人演绎一律标 transcript: approximate，页面上明写
 * 「以音为准，字是大意」。
 *
 * 所以 said 有两种填法：
 *   said: 你实际说的那句话        —— 自己写
 *   said: 同ai                    —— AI 那句意思一致，本人确认后直接用
 *
 * 唯一不许的是**留空放过去**：那等于把 AI 编的字悄悄安到真人录音上，
 * 读者会以为那就是他说的话。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INBOX = join(ROOT, '.inbox');
const MP3 = join(INBOX, 'mp3');
const DATA_DIR = join(ROOT, 'src/data/');
const TEXTS = join(INBOX, 'texts.yaml');

/** R2 对象上的投稿元数据。`said` 是投稿人自己写的那句，`ref` 是 AI 的普通话参考 */
interface Meta {
  place?: string; sceneId?: string; beatId?: string; contact?: string; note?: string;
  said?: string; ref?: string; hasAudio?: string; age?: string;
}
interface Obj { key: string; custom_metadata?: Meta }

/** said 写成这些词之一，表示「AI 那句就对，直接用」 */
const SAME_AS_AI = new Set(['同ai', '同AI', '=ai', '=AI', '同上', '一样']);

interface Draft {
  place: Place;
  /** 说话人代际，来自投稿表单；可选 */
  age?: AgeBand;
  contributor?: string;
  scenes: Record<string, Record<string, { intent?: string; ai?: string; ai_mandarin?: string; said: string; mandarin?: string; note?: string }>>;
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

/**
 * 拿一条 AI 参考行，只用来给草稿做对照和兜底普通话。
 *
 * 原先写死找 `dialectId === 'jilu'`——因为冀鲁离武城最近。2026-09-05 冀鲁的
 * AI 演绎全部下线之后，这个查找永远返回 null，草稿里不再有 ai 行，接稿会直接
 * 撞上「没有普通话对照」而全盘失败。写死一个方言 id 的代价就在这里。
 *
 * 现在取任意一条 AI 演绎：它只承担「这一拍大意是什么」，不承担「你该怎么说」。
 * 后者由投稿人自己在网页上写（said 字段），本来也不该由 AI 代劳。
 */
function aiLineFor(sceneId: string, beatId: string): { dialect: string; mandarin: string } | null {
  const dir = join(DATA_DIR, 'takes');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml'))) {
    const p = parse(readFileSync(join(dir, f), 'utf8')) as Take;
    if (p.sceneId !== sceneId || p.source !== 'tts') continue;
    const l = p.lines.find((x) => x.beatId === beatId);
    if (l) return { dialect: l.textDialect, mandarin: l.textMandarin };
  }
  return null;
}

function draft() {
  const objs = manifest();
  if (objs.length === 0) { console.log('.inbox 里没有投稿。'); return; }
  const scenes = loadScenes(DATA_DIR);

  const place = objs.find((o) => o.custom_metadata?.place)?.custom_metadata?.place ?? '';
  const ageGuess = objs.find((o) => o.custom_metadata?.age)?.custom_metadata?.age ?? '';
  const grouped: Record<string, string[]> = {};
  // 投稿人在网页上自己写的那句，按 场景/拍 索引，用来预填草稿。
  // 网页表单加了输入框之后，多数投稿会自带这句——不该再让审稿人凭空重写一遍。
  const saidBy: Record<string, string> = {};
  for (const o of objs) {
    const m = o.custom_metadata ?? {};
    if (!m.sceneId || !m.beatId) continue;
    (grouped[m.sceneId] ??= []).push(m.beatId);
    if (m.said) saidBy[`${m.sceneId}/${m.beatId}`] = m.said;
  }

  const lines: string[] = [
    '# 把投稿录音接进站点。填好每条 said: 之后跑 pnpm recordings:accept',
    '#',
    `# 投稿地点：${place || '（没填）'}`,
    '# 不要求逐字转写——很多方言词没有通行写法。页面上会明写「以音为准，字是大意」。',
    '# 两种填法：',
    "#   said: 你实际说的那句话     —— 自己写",
    "#   said: 同ai                 —— AI 那句意思一致，你确认后直接用它的字",
    '# 唯一不行的是留空：那等于把 AI 编的字悄悄安到你的录音上。',
    '# 某一句实在不想留，把整条删掉即可。',
    '',
    '# 你是哪儿人。主键是行政区划不是方言区——你知道自己是武城人，',
    '# 不一定知道自己属于「冀鲁官话」。dialectId 是可选注释，不知道就删掉这行。',
    'place:',
    "  code: '371428'",
    '  name: 武城县',
    '  province: 山东省',
    '  city: 德州市',
    '  lng: 116.07',
    '  lat: 37.21',
    '  dialectId: jilu',
    '',
    "contributor: ''   # 想署名就写个称呼，留空则不署",
    `age: ${JSON.stringify(ageGuess)}   # 代际：pre70 / 70s / 80s / 90s / 00s，不确定就留空`,
    '',
    'scenes:',
  ];

  for (const [sceneId, beats] of Object.entries(grouped)) {
    const scene = scenes.get(sceneId);
    const speaking = scene?.beats.filter((b) => b.speakerRole !== 'none') ?? [];
    const missing = speaking.filter((b) => !beats.includes(b.id)).map((b) => b.id);
    lines.push(`  # ${scene?.title ?? sceneId}`);
    if (missing.length) {
      lines.push(`  # 这一场还缺 ${missing.join(' / ')}——不影响接收，缺的拍会显示成「还没人认领」`);
    }
    lines.push(`  ${sceneId}:`);
    for (const b of speaking) {
      if (!beats.includes(b.id)) continue;
      const ai = aiLineFor(sceneId, b.id);
      lines.push(`    ${b.id}:`);
      lines.push(`      intent: ${JSON.stringify(b.intent)}`);
      if (ai) {
        lines.push(`      ai: ${JSON.stringify(ai.dialect)}`);
        lines.push(`      ai_mandarin: ${JSON.stringify(ai.mandarin)}`);
      }
      const filled = saidBy[`${sceneId}/${b.id}`] ?? '';
      lines.push(`      said: ${JSON.stringify(filled)}${filled ? '   # 投稿人自己写的，核一下' : ''}`);
      lines.push(`      mandarin: ''   # 普通话大意；写「同ai」或留空则沿用上面那行`);
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
  if (!d?.place?.code) throw new Error('texts.yaml 里缺 place.code');

  const scenes = loadScenes(DATA_DIR);
  const objs = manifest();
  const clipOf = (sceneId: string, beatId: string) =>
    objs.find((o) => o.custom_metadata?.sceneId === sceneId && o.custom_metadata?.beatId === beatId);

  // 1) 行政区划：已有就不动（别人可能已经在这个县录过）。
  // 点由贡献者创造——这里就是「创造」发生的地方：第一个从某个县投稿的人，
  // 把那个县带上地图。
  const placesPath = join(DATA_DIR, 'places.yaml');
  const places = parse(readFileSync(placesPath, 'utf8')) as Place[];
  if (!places.some((x) => x.code === d.place.code)) {
    places.push(d.place);
    writeFileSync(placesPath, stringify(places), 'utf8');
    console.log(`✓ 地图新增 ${d.place.province}${d.place.city}${d.place.name}（${d.place.code}）`);
  } else {
    console.log(`- ${d.place.name}（${d.place.code}）已在册，不动`);
  }

  let made = 0;
  for (const [sceneId, beats] of Object.entries(d.scenes ?? {})) {
    const scene = scenes.get(sceneId);
    if (!scene) { console.warn(`✗ ${sceneId} 不是已知场景，跳过`); continue; }
    const speaking = scene.beats.filter((b) => b.speakerRole !== 'none');
    const filled = Object.entries(beats).filter(([, v]) => (v.said ?? '').trim() !== '');

    // 缺拍**不再跳过**。旧规则要求录全整场戏，但真实投稿记录打脸了它：六拍
    // 两角色的戏，投稿人只录了 kid 那一个角色的两拍就停了——那不是半途而废，
    // 是一个人只演得了一个人。把半场戏判成废品，等于把最自然的贡献方式扔掉。
    if (filled.length === 0) {
      console.warn(`- ${scene.title} 跳过：一拍都没填`);
      continue;
    }
    const missing = speaking.filter((b) => !filled.some(([id]) => id === b.id));
    if (missing.length) {
      console.log(`  ${scene.title}：收 ${filled.length} 拍，缺 ${missing.map((b) => b.id).join(' / ')}（会显示成待认领）`);
    }

    const perfId = `${sceneId}.${d.place.code}`;
    const outDir = join(ROOT, 'public/audio', perfId);
    mkdirSync(outDir, { recursive: true });

    const perf: Take = {
      id: perfId,
      sceneId,
      placeCode: d.place.code,
      source: 'human',
      verification: 'human_recorded',
      // 真人录音的字一律标"大意"：方言词常常没有定字，逐字转写做不到，
      // 页面上会明写"以音为准"。要逐字的那天再手工改成 verbatim。
      transcript: 'approximate',
      ...(d.contributor ? { contributor: d.contributor } : {}),
      ...(d.age ? { age: d.age } : {}),
      lines: scene.beats.filter((b) => b.speakerRole === 'none' || beats[b.id]?.said?.trim()).map((b) => {
        if (b.speakerRole === 'none') {
          // 空拍沿用骨架里的处理：不配音频
          return { beatId: b.id, textDialect: '——', textMandarin: '（沉默）' };
        }
        const v = beats[b.id];
        // 「同ai」＝本人确认 AI 那句跟自己说的意思一致，直接采用它的字。
        // 这是一次有意识的确认，跟"留空被默默填上"完全不是一回事。
        const said = SAME_AS_AI.has(v.said.trim()) ? (v.ai ?? '').trim() : v.said.trim();
        if (!said) throw new Error(`${perfId} 的 ${b.id}：said 写了「同ai」但草稿里没有 ai 那行`);
        // 普通话对照：自己写的优先，否则用 AI 那行的翻译。
        // **绝不回落到 beat.intent**——intent 是舞台提示（"上门直接开口要钱"），
        // 不是这句话的普通话翻译，摆在"普通话对照"的位置上是答非所问。
        const rawM = (v.mandarin ?? '').trim();
        const mandarin = rawM && !SAME_AS_AI.has(rawM) ? rawM : (v.ai_mandarin ?? '').trim();
        if (!mandarin) {
          throw new Error(
            `${perfId} 的 ${b.id}：没有普通话对照——自己填 mandarin，或让草稿带上 ai_mandarin`,
          );
        }
        const clip = clipOf(sceneId, b.id);
        const sid = clip ? shortId(clip.key) : '';
        const src = join(MP3, `${sid}.mp3`);
        if (!sid || !existsSync(src)) throw new Error(`${perfId} 的 ${b.id} 找不到已转码的音频（${src}）`);
        const dest = join(outDir, `${b.id}.mp3`);
        copyFileSync(src, dest);
        const ms = measureDurationMs(dest);
        return {
          beatId: b.id,
          textDialect: said,
          textMandarin: mandarin,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
          audio: `/audio/${perfId}/${b.id}.mp3`,
          ...(ms !== undefined ? { durationMs: ms } : {}),
        };
      }),
    };

    writeFileSync(join(DATA_DIR, 'takes', `${perfId}.yaml`), stringify(perf), 'utf8');
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
