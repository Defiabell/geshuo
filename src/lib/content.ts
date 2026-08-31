import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { PERFORMANCE_SOURCES, SPEAKER_ROLES, VERIFICATIONS } from './types';
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
  // 骨架，写骨架不该被"还没配演绎"挡住检查。speakerRole 拼错会被两个消费方
  // 静默吞掉（player.ts 把所有剪影调暗、tts.ts 的情绪指令悄悄退回空串），
  // 所以在这里就拦住，不留到运行时才发现。
  for (const scene of scenes.values()) {
    for (const beat of scene.beats) {
      if (!SPEAKER_ROLES.includes(beat.speakerRole)) {
        throw new Error(
          `场景 ${scene.id} 的 beat ${beat.id}：speakerRole 非法：${beat.speakerRole}——` +
            `必须是 ${SPEAKER_ROLES.join(' / ')} 之一`,
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

export function linesForBeat(
  performances: Performance[],
  beatId: string,
): Array<{ performance: Performance; line: PerformanceLine }> {
  const out: Array<{ performance: Performance; line: PerformanceLine }> = [];
  for (const p of performances) {
    const line = p.lines.find((l) => l.beatId === beatId);
    if (line) out.push({ performance: p, line });
  }
  return out;
}
