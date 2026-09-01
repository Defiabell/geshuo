import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { NO_SPEAKER, PERFORMANCE_SOURCES, TRANSCRIPTS, VERIFICATIONS, VOICE_PROFILES } from './types';
import type { Dialect, DialectLevel, Performance, PerformanceLine, Scene } from './types';

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

export function loadPerformances(dataDir: string): Performance[] {
  return readYamlDir<Performance>(join(dataDir, 'performances'));
}

export function validateContent(
  scenes: Map<string, Scene>,
  performances: Performance[],
  dialects: Map<string, Dialect>,
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

  for (const p of performances) {
    const scene = scenes.get(p.sceneId);
    if (!scene) throw new Error(`演绎 ${p.id} 指向不存在的场景：${p.sceneId}`);

    const dialect = dialects.get(p.dialectId);
    if (!dialect) throw new Error(`演绎 ${p.id} 指向不存在的方言：${p.dialectId}`);

    // verification / source 拼错是两个"诚实标注"能被静默关掉的路径：
    // verification 拼错 → LineCard 的可信度标签渲染成 undefined；
    // source 拼错（比如写成 'TTS'）→ GrainNotice 的粒度声明条整条消失。
    if (!VERIFICATIONS.includes(p.verification)) {
      throw new Error(
        `演绎 ${p.id} 的 verification 非法：${p.verification}——` +
          `必须是 ${VERIFICATIONS.join(' / ')} 之一，否则可信度标签会渲染成空`,
      );
    }
    if (!PERFORMANCE_SOURCES.includes(p.source)) {
      throw new Error(
        `演绎 ${p.id} 的 source 非法：${p.source}——` +
          `必须是 ${PERFORMANCE_SOURCES.join(' / ')} 之一，否则粒度声明条会静默消失`,
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

    if (p.source === 'tts' && TTS_FORBIDDEN_LEVELS.has(dialect.level)) {
      throw new Error(
        `演绎 ${p.id}：TTS 演绎不得挂在点级/小片级方言（${p.dialectId}）——模型给不出县域颗粒的口音`,
      );
    }

    const beatIds = new Set(scene.beats.map((b) => b.id));
    const lineIds = new Set(p.lines.map((l) => l.beatId));

    for (const b of beatIds) {
      if (!lineIds.has(b)) throw new Error(`演绎 ${p.id} 缺少 beat: ${b}`);
    }
    for (const l of lineIds) {
      if (!beatIds.has(l)) throw new Error(`演绎 ${p.id} 含未知 beat: ${l}`);
    }
    if (p.lines.length !== scene.beats.length) {
      throw new Error(`演绎 ${p.id} 的台词条数与场景拍数不符`);
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
export function linesForBeat(
  performances: Performance[],
  sceneId: string,
  beatId: string,
): Array<{ performance: Performance; line: PerformanceLine }> {
  const out: Array<{ performance: Performance; line: PerformanceLine }> = [];
  for (const p of performances) {
    if (p.sceneId !== sceneId) continue;
    const line = p.lines.find((l) => l.beatId === beatId);
    if (line) out.push({ performance: p, line });
  }
  return out;
}
