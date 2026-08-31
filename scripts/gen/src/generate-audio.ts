import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import { voiceFor, instructFor, countBilledChars } from './tts';
import type { Performance } from '../../../src/lib/types';
import type { VoiceSpec } from './tts';

// fileURLToPath() 而不是 new URL(...).pathname——.pathname 不做百分号解码，
// 路径里带空格或中文会直接变成 ENOENT，而这个 ROOT 是读演绎数据、写生成
// 音频 mp3 与回写 YAML 的锚点。
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DATA_DIR = join(ROOT, 'src/data/');

const QWEN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/**
 * 云端合成（Qwen3-TTS 系）：`chengyu`/`yue` 走这条路，用的是百炼公共端点，
 * 不需要额外的工作空间部署，直接用 DASHSCOPE_API_KEY 就能调。
 *
 * 请求体字段核对过官方文档（非实时语音合成用户指南 + Qwen3-TTS 调用示例）：
 * - `input.text` / `input.voice` / `input.language_type` 是文档给的原样字段名。
 * - `language_type` 是语言大类（"Chinese"/"English"/"Auto"），不是方言名——
 *   方言音色由 `voice` 决定（比如 Rocky=粤语），中文方言音色统一填 "Chinese"。
 * - 响应体 `output.audio.url` 官方示例（Java SDK
 *   `result.getOutput().getAudio().getUrl()`）与之一致，原样保留。
 *
 * 情绪指令字段（code review 后修正）：`instructions` 字段**只有
 * Qwen3-TTS-Instruct-Flash 系列支持**——non-realtime-tts-user-guide 页面原文
 * 明确写着「如需使用指令控制功能，请将 model 替换为 qwen3-tts-instruct-flash」。
 * 普通 `qwen3-tts-flash` 的请求体示例里根本没有这个字段，带了也会被服务端静默
 * 忽略——不报错、也不生效，妈妈那几句的怒气就没了。所以这里按「本次调用是否
 * 带情绪指令」动态换模型名，而不是固定用 `spec.model`。`qwen3-tts-instruct-flash`
 * 是真实存在的独立计费模型（model-pricing 页面确认，0.8 元/万字符，跟普通
 * qwen3-tts-flash 同价）。
 *
 * 未核实、留给实跑验证的点：官方 Java 示例把下载到的文件存成
 * `downloaded_audio.wav`，暗示 audio.url 背后可能是 wav 编码而不是 mp3（这个模型
 * 的请求体里没有 format 参数可以显式指定，跟下面 CosyVoice 那条路不一样）。这里
 * 仍按 Task 7 的 Produces 接口约定把文件名写成 `.mp3`，如果实跑发现服务端返回的
 * 确实是别的编码，需要在这里加一步转码或者按响应 content-type 决定扩展名。
 */
async function synthQwenCloud(text: string, instructions: string, spec: VoiceSpec): Promise<Buffer> {
  // 实测（2026-08-31，真实 API）：qwen3-tts-instruct-flash 不支持方言音色，
  // 传 Sunny 直接 400「Voice 'Sunny' is not supported」；而 qwen3-tts-flash
  // 带 instructions 可以正常返回音频。方言真实性优先于情绪控制，故恒用 spec.model。
  const model = spec.model;
  const res = await fetch(QWEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model,
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
  const audio = await fetch(body.output.audio.url);
  return Buffer.from(await audio.arrayBuffer());
}

/**
 * 云端合成（CosyVoice v3 系）：`jilu`/`dongbei` 走这条路。
 *
 * 这是 code review 后新加的分支——第一轮实现把「CosyVoice 3」直接当成了「本地
 * 自建推理」，漏查了阿里云百炼自己也把 CosyVoice v3 托管成了云端模型
 * （`cosyvoice-v3-flash`），有一张独立于 Qwen3-TTS 的音色表。核对
 * cosyvoice-tts-http-api 文档确认这条路径的请求结构跟上面的 Qwen3-TTS 完全不同：
 *
 * - 请求 URL 是**工作空间专属端点** `{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，
 *   不是 `dashscope.aliyuncs.com`。这意味着这条云端路径要跑通，除了
 *   DASHSCOPE_API_KEY，还得先在百炼控制台把 cosyvoice-v3-flash 部署到一个工作
 *   空间、拿到 WorkspaceId——不是纯粹换个模型名就能零配置直接调用，这一点比
 *   Qwen3-TTS-Flash 多一步部署成本，下面用 DASHSCOPE_WORKSPACE_ID 环境变量表达，
 *   缺失时直接抛错，不悄悄拿错误的域名去打一个必然失败的请求。
 * - `input.format`（合法值 mp3/pcm/wav/opus，这里选 mp3）、`input.sample_rate`
 *   是这个 API 独有的字段，Qwen3-TTS-Flash 没有——这条路径反而比 Qwen3-TTS-Flash
 *   更明确地确认了输出真的是 mp3，不用像上面那条路一样靠猜。
 * - 情绪/方言指令字段叫 `instruction`（单数），不是 `instructions`。
 * - 响应体结构跟 Qwen3-TTS-Flash 一致，仍是 `output.audio.url`。
 *
 * 未核实、留给实跑验证的点：`spec.dialectInstruction`（方言切换指令，固定格式
 * 「请用<方言>表达。」）和 `instructFor(speakerRole)`（情绪指令，比如「用非常
 * 生气…的口气说」）怎么组合成一句话，官方文档只给了单独的方言指令格式示例，
 * 没有演示两者同时生效的写法。这里按「情绪在前、方言切换在后」用顿号拼接，是
 * 未经实测验证的最佳猜测——如果实跑发现两者会互相打架（比如方言切换生效但情绪
 * 没生效，或反过来），需要换成分两次合成再拼接音频、或者只保留其中一个指令。
 */
function cosyvoiceEndpoint(): string {
  // 实测（2026-08-31，真实 API）：CosyVoice 走 /audio/tts/SpeechSynthesizer，
  // 不是 Qwen 的 multimodal-generation 路径。此前「必须先部署工作空间拿
  // WorkspaceId」的判断是错的——报的 url error 是路径不对，不是域名不对。
  // 公共域名 + 正确路径直接可用；设了 DASHSCOPE_WORKSPACE_ID 则优先用专属域名。
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID;
  const host = workspaceId
    ? `${workspaceId}.cn-beijing.maas.aliyuncs.com`
    : 'dashscope.aliyuncs.com';
  return `https://${host}/api/v1/services/audio/tts/SpeechSynthesizer`;
}


async function synthCosyvoiceCloud(text: string, mood: string, spec: VoiceSpec): Promise<Buffer> {
  const instruction = [mood, spec.dialectInstruction].filter(Boolean).join('，');
  const res = await fetch(cosyvoiceEndpoint(), {
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
        // 实测：CosyVoice 的字段名是 instruct，写成 instruction 会被引擎拒为
        // 「Engine return error code: 428」——与 sample_rate 无关，纯字段名问题。
        ...(instruction ? { instruct: instruction } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`DashScope(CosyVoice) ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { output: { audio: { url: string } } };
  const audio = await fetch(body.output.audio.url);
  return Buffer.from(await audio.arrayBuffer());
}

/**
 * 本地合成：目前只有 `jiaoliao`（青岛话/胶辽官话）会落到这里——CosyVoice 音色
 * 表里没有青岛专属音色，而"山东话"这个 instruct 大类能不能准确覆盖胶辽官话的
 * 口音，必须真人听测才能下结论，代码不该替用户假设，所以宁可标成本地也不拿
 * 云端的山东话音色顶替。
 *
 * 这条路径本身还没有接：这台机器没有 PyTorch/MPS 环境，没法下载权重、跑通
 * 本地 CosyVoice 3 推理、确认真实 speaker id，所以先诚实地抛错而不是假装能
 * 出声。也是 `--local` 强制开关目前唯一会走到的分支——即便传了 `--local`，
 * 这里同样会抛错，因为本地推理服务本来就没搭。
 *
 * 待办（留给下一次接入本地推理时做）：
 * 1. 起一个本地 CosyVoice 3 推理服务（HTTP 或直接 Python 子进程都行）；
 * 2. 确认它的方言指令控制接口——CosyVoice2/3 的方言不是靠固定 speaker id 选出来的，
 *    而是「基础音色 + instruct 文本」组合（比如「用青岛话说」），tts.ts 里
 *    `jiaoliao` 的 voice 字段（'qingdao'）目前只是占位的方言拼音 slug，接入时
 *    要换成真实可用的调用方式；
 * 3. 把下面这个函数换成真正打本地服务的 fetch/子进程调用。
 */
async function synthLocal(_text: string, _mood: string, spec: VoiceSpec): Promise<Buffer> {
  throw new Error(
    `本地 CosyVoice 3 合成尚未接入（方言 ${spec.dialect}，voice=${spec.voice}）：` +
      '这台机器没有跑通本地推理环境，也没有验证过真实 speaker id。' +
      '先把本地推理服务搭起来再回来接这个函数，不要在没验证的情况下瞎编一个调用方式。',
  );
}

async function synthCloud(text: string, mood: string, spec: VoiceSpec): Promise<Buffer> {
  if (spec.model.startsWith('cosyvoice-')) return synthCosyvoiceCloud(text, mood, spec);
  return synthQwenCloud(text, mood, spec);
}

async function synth(text: string, mood: string, spec: VoiceSpec, useLocal: boolean): Promise<Buffer> {
  // 优先级：--local 强制走本地；否则按 spec.model 是不是"本地占位模型"自动
  // 判断——只有 jiaoliao 的 spec.model 是 'cosyvoice3-local'，会自动落到本地
  // 分支；jilu/dongbei/chengyu/yue 都有真实云端模型，不会被误判成本地。
  if (useLocal || spec.model === 'cosyvoice3-local') return synthLocal(text, mood, spec);
  return synthCloud(text, mood, spec);
}

async function main() {
  const args = process.argv.slice(2);
  const useLocal = args.includes('--local');
  const performanceId = args.find((a) => !a.startsWith('--'));
  if (!performanceId) {
    console.error('用法: pnpm run gen:audio -- <performanceId> [--local]');
    process.exit(1);
  }

  const path = join(DATA_DIR, 'performances', `${performanceId}.yaml`);
  const perf = parse(readFileSync(path, 'utf8')) as Performance;
  const scene = loadScenes(DATA_DIR).get(perf.sceneId)!;
  const spec = voiceFor(perf.dialectId);

  const outDir = join(ROOT, 'public/audio', performanceId);
  mkdirSync(outDir, { recursive: true });

  let billed = 0;
  for (const line of perf.lines) {
    const beat = scene.beats.find((b) => b.id === line.beatId)!;
    if (beat.speakerRole === 'none') {
      console.log(`- ${line.beatId} 空拍，跳过`);
      continue;
    }

    const outPath = join(outDir, `${line.beatId}.mp3`);

    // 幂等：已经有文件、YAML 里也记着这条音频，说明上次跑成功过，直接跳过——
    // 不重新合成、不重新计费。这条是 code review 后补的：之前的实现每条落盘后
    // 不立刻回写 YAML，中途失败（网络错误、额度耗尽）就会留下已合成、已计费的
    // 孤儿 mp3 文件（YAML 没记录、审核台看不到），下次重跑还会对着这些行重新
    // 合成、重复计费。
    if (existsSync(outPath) && line.audio) {
      console.log(`- ${line.beatId} 已有音频，跳过（幂等）`);
      continue;
    }

    const buf = await synth(line.textDialect, instructFor(beat.speakerRole), spec, useLocal);
    writeFileSync(outPath, buf);
    line.audio = `/audio/${performanceId}/${line.beatId}.mp3`;
    billed += countBilledChars(line.textDialect);

    // 每条成功后立刻整份回写 YAML，而不是等循环全部跑完——这样中途失败时，
    // 已经合成成功的那几条不会变成 YAML 里查无此音频的孤儿文件。
    writeFileSync(path, stringify(perf), 'utf8');
    console.log(`✓ ${line.beatId}`);
  }

  console.log(`✓ 计费字符 ${billed}（约 ${(billed / 10000).toFixed(4)} 元，按 0.8~1 元/万字符估算，具体看落到哪个模型）`);
  console.log('  试听：pnpm run dev 后打开 /review/');
}

// 仅在直接作为入口脚本运行时才执行 main()——被测试文件 import 时不能触发
// 网络请求 / process.exit，同 generate-script.ts 的约定。用 pathToFileURL()
// 而不是手工拼 `file://${process.argv[1]}`：手工拼接不做 URL 编码，argv[1]
// 里的空格（或 Windows 盘符）会让这个比较永远为假，main() 就再也不会被触发。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
