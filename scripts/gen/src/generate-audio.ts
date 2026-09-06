import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import { NO_SPEAKER } from '../../../src/lib/types';
import { voiceFor, instructionFor, countBilledChars, INSTRUCT_MODEL } from './tts';
import { measureDurationMs } from './duration';
import type { Take } from '../../../src/lib/types';
import type { VoiceSpec } from './tts';

// fileURLToPath() 而不是 new URL(...).pathname——.pathname 不做百分号解码，
// 路径里带空格或中文会直接变成 ENOENT，而这个 ROOT 是读演绎数据、写生成
// 音频 mp3 与回写 YAML 的锚点。
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DATA_DIR = join(ROOT, 'src/data/');

/** Qwen3-TTS 系（方言专属音色：Sunny/Eric/Rocky/Kiki）走这个端点 */
const QWEN_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
/** CosyVoice 与 qwen-audio-3.0-tts 系共用这个端点，只是请求体字段不同 */
const SPEECH_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

async function fetchAudio(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载音频失败 ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Qwen3-TTS 路径（chengyu / yue）。方言由音色自带，不依赖任何指令。
 *
 * `instructions`（复数）是这个端点的情绪指令字段。方言专属音色在这条路上
 * 是主角，情绪是锦上添花——即便这个字段被服务端忽略，出来的仍然是货真价实
 * 的四川话/粤语，不会像 CosyVoice 那样静默退回普通话。
 *
 * 实测记录（2026-08-31）：`qwen3-tts-instruct-flash` 不支持方言音色，传 Sunny
 * 直接 400「Voice 'Sunny' is not supported」。方言真实性优先于情绪控制，所以
 * 这里恒用 spec.model，绝不为了情绪去换成 instruct 模型。
 */
async function synthQwen(text: string, instructions: string, spec: VoiceSpec): Promise<Buffer> {
  const res = await fetch(QWEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: spec.model,
      input: {
        text,
        voice: spec.voice,
        language_type: 'Chinese',
        ...(instructions ? { instructions } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`DashScope ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { output: { audio: { url: string } } };
  return fetchAudio(body.output.audio.url);
}

/**
 * SpeechSynthesizer 路径。两个模型共用，但对指令的态度完全相反：
 *
 * - `qwen-audio-3.0-tts-flash`：**支持** `input.instruction`（单数）。方言与
 *   情绪都靠它，实测带与不带输出不同、情绪可叠加在方言之上。
 * - `cosyvoice-v3-flash`：**完全无视**任何指令字段（实测五种指令输出 md5
 *   相同）。所以这条路只用来跑方言专属音色（longlaotie_v3），并且刻意不发
 *   instruction——发一个已知无效的字段只会让人误以为情绪生效了。
 *
 * 这个区别是花钱买来的教训：早先用 cosyvoice-v3-flash + 「请用山东话表达。」
 * 生成的冀鲁官话，其实一句山东话都没有。判断方法见 tts.ts 顶部注释：同一段
 * 文本带/不带指令各跑一次，比 md5。
 */
async function synthSpeech(text: string, instruction: string, spec: VoiceSpec): Promise<Buffer> {
  const supportsInstruction = spec.model === INSTRUCT_MODEL;
  const res = await fetch(SPEECH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: spec.model,
      input: {
        text,
        voice: spec.voice,
        format: 'mp3',
        sample_rate: 24000,
        ...(supportsInstruction && instruction ? { instruction } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`DashScope(${spec.model}) ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { output: { audio: { url: string } } };
  return fetchAudio(body.output.audio.url);
}

async function synth(text: string, instruction: string, spec: VoiceSpec): Promise<Buffer> {
  if (spec.model.startsWith('qwen3-tts')) return synthQwen(text, instruction, spec);
  return synthSpeech(text, instruction, spec);
}

/** 决定合成输出的全部输入：换任何一样都必须重新合成 */
function fingerprint(text: string, instruction: string, spec: VoiceSpec): string {
  return createHash('sha256')
    .update(`${spec.model}\u0000${spec.voice}\u0000${instruction}\u0000${text}`)
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  const takeId = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!takeId) {
    console.error('用法: pnpm run gen:audio -- <takeId>');
    process.exit(1);
  }

  const path = join(DATA_DIR, 'takes', `${takeId}.yaml`);
  const perf = parse(readFileSync(path, 'utf8')) as Take;
  const scene = loadScenes(DATA_DIR).get(perf.sceneId);
  if (!scene) throw new Error(`演绎 ${takeId} 指向不存在的场景：${perf.sceneId}`);

  // 这个脚本只服务 AI 演绎。真人录音挂的是 placeCode 不是 dialectId，而且它的
  // 音频是人录的——一旦让合成跑上去，覆盖的是不可再生的东西。
  if (perf.source !== 'tts' || !perf.dialectId) {
    throw new Error(
      `演绎 ${takeId} 不是 AI 演绎（source=${perf.source}）——` +
        '合成脚本不碰真人录音，那是不可再生的',
    );
  }

  const outDir = join(ROOT, 'public/audio', takeId);
  mkdirSync(outDir, { recursive: true });

  // 内容指纹表：beatId -> sha256(文本 + 指令 + 音色规格)
  const hashPath = join(outDir, '.hashes.json');
  const hashes: Record<string, string> = existsSync(hashPath)
    ? (JSON.parse(readFileSync(hashPath, 'utf8')) as Record<string, string>)
    : {};

  let billed = 0;
  for (const line of perf.lines) {
    const beat = scene.beats.find((b) => b.id === line.beatId);
    if (!beat) throw new Error(`演绎 ${takeId} 含场景里没有的拍：${line.beatId}`);
    if (beat.speakerRole === NO_SPEAKER) {
      console.log(`- ${line.beatId} 空拍，跳过`);
      continue;
    }

    // 角色来自场景自己的 roles 表——声色和情绪都跟着角色走，所以同一份演绎
    // 里妈妈和孩子会落到两个不同的音色上，而不是共用一副嗓子。
    const role = scene.roles[beat.speakerRole];
    if (!role) {
      throw new Error(
        `场景 ${scene.id} 的 beat ${beat.id} 用了未声明的角色 ${beat.speakerRole}` +
          '——先在场景 YAML 的 roles 里声明它的声色档位',
      );
    }
    const spec = voiceFor(perf.dialectId, role.voice);
    const instruction = instructionFor(role.mood, spec);

    const outPath = join(outDir, `${line.beatId}.mp3`);

    /**
     * 幂等按**内容指纹**判，不按文件是否存在判。
     *
     * 原先是「有文件就跳过」。2026-09-06 改台词时踩到：五条台词全部重写，
     * 脚本一条都没重新合成，页面上于是「字是新的、音是旧的」——这是最坏的
     * 一种不一致，因为它安静、看不出来，而且这个站的全部价值就在于字和音
     * 对得上。同理换音色、换情绪指令也一样悄悄失效。
     *
     * 指纹覆盖真正决定输出的三样：文本、指令、音色规格。指纹存在音频目录里
     * （随音频一起被 gitignore，也随音频一起搬走），不进内容模型。
     */
    const fp = fingerprint(line.textDialect, instruction, spec);
    if (existsSync(outPath) && line.audio && hashes[line.beatId] === fp) {
      console.log(`- ${line.beatId} 内容没变，跳过（幂等）`);
      continue;
    }
    if (existsSync(outPath) && hashes[line.beatId] !== fp) {
      console.log(`~ ${line.beatId} 内容变了，重新合成`);
    }

    const buf = await synth(line.textDialect, instruction, spec);
    writeFileSync(outPath, buf);
    hashes[line.beatId] = fp;
    writeFileSync(hashPath, JSON.stringify(hashes, null, 2), 'utf8');
    line.audio = `/audio/${takeId}/${line.beatId}.mp3`;
    // 量不到就不写这个字段，界面据此不显示秒数——不编数字
    const ms = measureDurationMs(outPath);
    if (ms !== undefined) line.durationMs = ms;
    billed += countBilledChars(line.textDialect);

    // 每条成功后立刻整份回写 YAML，而不是等循环全部跑完——这样中途失败时，
    // 已经合成成功的那几条不会变成 YAML 里查无此音频的孤儿文件。
    writeFileSync(path, stringify(perf), 'utf8');
    console.log(`✓ ${line.beatId}  ${role.name}(${role.voice})  ${spec.model}/${spec.voice}`);
  }

  console.log(`✓ 计费字符 ${billed}（约 ${(billed / 10000).toFixed(4)} 元，按 0.8~1 元/万字符估算）`);
  console.log('  试听：pnpm run dev 后打开 /review/');
}

// 仅在直接作为入口脚本运行时才执行 main()——被测试文件 import 时不能触发
// 网络请求 / process.exit。用 pathToFileURL() 而不是手工拼 `file://${argv[1]}`：
// 手工拼接不做 URL 编码，路径里的空格会让这个比较永远为假。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
