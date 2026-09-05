import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadDialects } from './dialect-tree';
import { NO_SPEAKER, TAKE_SOURCES, TRANSCRIPTS, VERIFICATIONS, VOICE_PROFILES } from './types';
import type { Dialect, DialectLevel, Place, Scene, Take, TakeLine } from './types';

/** TTS 到不了县级颗粒——point（点）与 subcluster（小片）都在县域颗粒上，禁止挂 TTS 演绎 */
const TTS_FORBIDDEN_LEVELS = new Set<DialectLevel>(['point', 'subcluster']);

function readYamlDir<T>(dir: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => parse(readFileSync(join(dir, f), 'utf8')) as T);
}

export function loadScenes(dataDir: string): Map<string, Scene> {
  const scenes = readYamlDir<Scene>(join(dataDir, 'scenes'));
  const map = new Map<string, Scene>();
  for (const s of scenes) {
    if (map.has(s.id)) throw new Error(`场景 id 重复：${s.id}`);
    map.set(s.id, s);
  }
  return map;
}

export function loadTakes(dataDir: string): Take[] {
  return readYamlDir<Take>(join(dataDir, 'takes'));
}

/**
 * 行政区划登记表。只登记真的有人贡献过的地方——不预先枚举全国 2800 个县。
 */
export function loadPlaces(dataDir: string): Map<string, Place> {
  const list = parse(readFileSync(join(dataDir, 'places.yaml'), 'utf8')) as Place[];
  const map = new Map<string, Place>();
  for (const pl of list) {
    if (!/^\d{6}$/.test(pl.code)) {
      throw new Error(`行政区划代码必须是六位数字：${pl.code}（${pl.name}）`);
    }
    if (map.has(pl.code)) throw new Error(`行政区划代码重复：${pl.code}`);
    map.set(pl.code, pl);
  }
  return map;
}

export function validateContent(
  scenes: Map<string, Scene>,
  takes: Take[],
  dialects: Map<string, Dialect>,
  places: Map<string, Place>,
): void {
  // 场景骨架本身要先过关，不依赖是否已经有演绎——下一步内容动作就是加场景
  // 骨架，写骨架不该被"还没配演绎"挡住检查。
  //
  // 角色现在由场景自己声明（scene.roles），所以这里校验两件事：
  // 1. 每个角色的 voice 是合法声色档位——写错会让 voiceFor() 在合成时才炸，
  //    而那时已经花过钱了；
  // 2. 每个 beat 的 speakerRole 要么是保留值 'none'（空拍），要么在 roles 里
  //    声明过——拼错一个角色名，generate-audio.ts 会查不到声色和情绪，
  //    合成出一个用错嗓子的版本，而页面上看不出任何异常。
  for (const scene of scenes.values()) {
    for (const [key, role] of Object.entries(scene.roles ?? {})) {
      if (key === NO_SPEAKER) {
        throw new Error(`场景 ${scene.id}：'${NO_SPEAKER}' 是空拍保留值，不能拿来当角色名`);
      }
      if (!VOICE_PROFILES.includes(role.voice)) {
        throw new Error(
          `场景 ${scene.id} 的角色 ${key}：voice 非法：${role.voice}——` +
            `必须是 ${VOICE_PROFILES.join(' / ')} 之一`,
        );
      }
    }
    // 一句话挑战必须恰好一个说话拍。多于一拍就不是「一句话」了，投稿门槛
    // 立刻回到六拍那个量级，而降低门槛正是它存在的唯一理由。
    if (scene.weekly !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scene.weekly)) {
        throw new Error(`场景 ${scene.id} 的 weekly 必须是 YYYY-MM-DD：${scene.weekly}`);
      }
      const speaking = scene.beats.filter((b) => b.speakerRole !== NO_SPEAKER);
      if (speaking.length !== 1) {
        throw new Error(
          `一句话挑战 ${scene.id} 有 ${speaking.length} 个说话拍——必须恰好 1 个，` +
            '多了就不是「一句话」，投稿门槛会退回六拍那个量级',
        );
      }
    }

    for (const beat of scene.beats) {
      const known = beat.speakerRole === NO_SPEAKER || beat.speakerRole in (scene.roles ?? {});
      if (!known) {
        throw new Error(
          `场景 ${scene.id} 的 beat ${beat.id}：speakerRole 非法：${beat.speakerRole}——` +
            `必须是 '${NO_SPEAKER}' 或 roles 里声明过的角色（${Object.keys(scene.roles ?? {}).join(' / ') || '当前没有声明任何角色'}）`,
        );
      }
    }
  }

  for (const p of takes) {
    const scene = scenes.get(p.sceneId);
    if (!scene) throw new Error(`演绎 ${p.id} 指向不存在的场景：${p.sceneId}`);

    // 身份二选一。两者不对称是故意的：AI 只到区级抽象，真人永远来自某个具体的县。
    // 允许「都有」会立刻产生一个歧义——这条录音到底代表武城，还是代表整个冀鲁官话？
    const hasDialect = p.dialectId !== undefined;
    const hasPlace = p.placeCode !== undefined;
    if (hasDialect === hasPlace) {
      throw new Error(
        `演绎 ${p.id} 的身份必须二选一：AI 演绎给 dialectId，真人贡献给 placeCode——` +
          (hasDialect ? '现在两个都有' : '现在两个都没有'),
      );
    }
    if (p.source === 'tts' && !hasDialect) {
      throw new Error(`演绎 ${p.id}：AI 演绎必须挂 dialectId，AI 到不了县级颗粒`);
    }
    if (p.source === 'human' && !hasPlace) {
      throw new Error(
        `演绎 ${p.id}：真人贡献必须挂 placeCode——人永远来自某个具体的县，` +
          '挂到方言区上等于替整个区代言',
      );
    }

    let dialect: Dialect | undefined;
    if (hasDialect) {
      dialect = dialects.get(p.dialectId!);
      if (!dialect) throw new Error(`演绎 ${p.id} 指向不存在的方言：${p.dialectId}`);
    }
    if (hasPlace && !places.has(p.placeCode!)) {
      throw new Error(
        `演绎 ${p.id} 指向未登记的行政区划：${p.placeCode}——` +
          '新地方要先写进 src/data/places.yaml（点由贡献者创造，但得登记）',
      );
    }

    // verification / source 拼错是两个"诚实标注"能被静默关掉的路径：
    // verification 拼错 → LineCard 的可信度标签渲染成 undefined；
    // source 拼错（比如写成 'TTS'）→ GrainNotice 的粒度声明条整条消失。
    if (!VERIFICATIONS.includes(p.verification)) {
      throw new Error(
        `演绎 ${p.id} 的 verification 非法：${p.verification}——` +
          `必须是 ${VERIFICATIONS.join(' / ')} 之一，否则可信度标签会渲染成空`,
      );
    }
    if (!TAKE_SOURCES.includes(p.source)) {
      throw new Error(
        `演绎 ${p.id} 的 source 非法：${p.source}——` +
          `必须是 ${TAKE_SOURCES.join(' / ')} 之一，否则粒度声明条会静默消失`,
      );
    }

    // transcript 拼错会让「文字是大意不是逐字」这句提示整条消失——
    // 跟 verification/source 一样，是个能被静默关掉的诚实标注
    if (p.transcript !== undefined && !TRANSCRIPTS.includes(p.transcript)) {
      throw new Error(
        `演绎 ${p.id} 的 transcript 非法：${p.transcript}——` +
          `必须是 ${TRANSCRIPTS.join(' / ')} 之一，否则「文字为大意」的提示会静默消失`,
      );
    }

    // 两道 AI 闸，理由不同不能合并：
    // 层级闸挡的是「颗粒太细」（模型给不出县域口音）；
    // noAiReason 挡的是「这个方言没有标准形式」——层级再粗也不行，冀鲁官话
    // 是区级，照样禁止。把后者写成数据而不是代码里的名单，是为了让理由能
    // 跟着显示到页面上。
    if (p.source === 'tts' && dialect) {
      if (dialect.noAiReason) {
        throw new Error(
          `演绎 ${p.id}：${p.dialectId} 已标注禁止 AI 生成——${dialect.noAiReason}`,
        );
      }
      if (TTS_FORBIDDEN_LEVELS.has(dialect.level)) {
        throw new Error(
          `演绎 ${p.id}：TTS 演绎不得挂在点级/小片级方言（${p.dialectId}）——模型给不出县域颗粒的口音`,
        );
      }
    }

    // 拍覆盖规则对 AI 和真人不一样，这是刻意的不对称：
    //
    // AI 必须录全——它是脚本批量生成的，缺一拍就是生成失败，不该悄悄上站。
    //
    // 真人可以只录一部分。旧模型要求录全，但真实投稿记录打脸了它：六拍两角色
    // 的戏，owner 只录了 kid 那一个角色的两拍就停了。那不是半途而废，是**一个人
    // 只演得了一个人**。把半场戏判成「未完成」，等于把最自然的贡献方式判成失败。
    // 半场戏该读作「已认领一半，缺另一半」——那恰恰是最强的召唤。
    const beatIds = new Set(scene.beats.map((b) => b.id));
    const lineIds = new Set(p.lines.map((l) => l.beatId));

    if (lineIds.size !== p.lines.length) {
      throw new Error(`演绎 ${p.id} 有重复的 beat`);
    }
    for (const l of lineIds) {
      if (!beatIds.has(l)) throw new Error(`演绎 ${p.id} 含未知 beat: ${l}`);
    }
    if (p.lines.length === 0) {
      throw new Error(`演绎 ${p.id} 一拍都没有`);
    }
    if (p.source === 'tts') {
      for (const b of beatIds) {
        if (!lineIds.has(b)) {
          throw new Error(
            `AI 演绎 ${p.id} 缺少 beat: ${b}——AI 是批量生成的，缺一拍就是生成失败`,
          );
        }
      }
    }
  }
}

/**
 * 取出同一场戏里同一拍的各方言说法，用于横向对比。
 *
 * 必须带 sceneId：拍号只在场景内唯一，三个场景都用 b1..b6，只按 beatId 匹配
 * 会把「上门要债」的台词混进「深夜回家」的对比页。调用方即使已经自己过滤过
 * 场景，这里也再滤一次——签名上就堵死这个误用，比依赖每个调用方记得过滤可靠。
 */
export function takesForBeat(
  takes: Take[],
  sceneId: string,
  beatId: string,
): Array<{ take: Take; line: TakeLine }> {
  const out: Array<{ take: Take; line: TakeLine }> = [];
  for (const t of takes) {
    if (t.sceneId !== sceneId) continue;
    const line = t.lines.find((l) => l.beatId === beatId);
    if (line) out.push({ take: t, line });
  }
  return out;
}

/**
 * 同一场戏、同一个身份（一个县或一个方言区）下的所有演绎。
 *
 * 返回数组而不是单份，是这次改模型的核心：一个地方可以有好几个人各说各的，
 * 而**分歧本身是内容**——三个武城人给三个说法，那是代际差、村落差的真实记录，
 * 不是数据脏了。语保的方法论是「每点选一个合格发音人代表该点」，一点一答案；
 * 这里刻意不这么做，因为 owner 本人（武城人）说「感觉我一个人说的也不对」。
 */
export function takesFor(takes: Take[], sceneId: string, identity: string): Take[] {
  return takes.filter((t) => t.sceneId === sceneId && (t.dialectId ?? t.placeCode) === identity);
}

/**
 * 一次装好整个站的内容，并且**校验过**。
 *
 * 存在的理由：七个页面原先各自重复同一段四行装配（loadDialects / loadScenes /
 * loadTakes / validateContent），加一种数据就要改七处，而漏改的那一处不会报错——
 * 它只是少校验一层，然后带着坏数据静静构建成功。对比页当时就漏了 validateContent。
 *
 * 收口之后，「忘了传 places」这种事在类型层就不成立。
 */
export function loadSite(dataDir: string): {
  scenes: Map<string, Scene>;
  takes: Take[];
  dialects: Map<string, Dialect>;
  places: Map<string, Place>;
} {
  const dialects = loadDialects(dataDir);
  const scenes = loadScenes(dataDir);
  const takes = loadTakes(dataDir);
  const places = loadPlaces(dataDir);
  validateContent(scenes, takes, dialects, places);
  return { scenes, takes, dialects, places };
}
