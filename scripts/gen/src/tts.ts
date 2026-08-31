import { SPEAKER_ROLES } from '../../../src/lib/types';
import type { SpeakerRole } from '../../../src/lib/types';

export interface VoiceSpec {
  model: string;
  voice: string;
  dialect: string;
  /**
   * CosyVoice 系（cosyvoice-v3-flash）里靠指令切换方言的系统音色（比如
   * longanhuan_v3）需要额外带一句固定格式的指令文本（「请用<方言>表达。」）——
   * 已经是方言专属音色的（比如东北话的 longlaotie_v3）不需要，留空。
   * 只有 cosyvoice-v3-flash 这条路径会用到这个字段。
   */
  dialectInstruction?: string;
}

/**
 * 方言节点 → 音色。
 *
 * 这份映射经过两轮核对：
 *
 * 第一轮（2026-08-31）：brief 里所有方言都指向 `qwen-audio-3.0-tts-flash` 的
 * `chelsie` 音色，核对后发现 `chelsie`（千雪）是纯普通话音色，五个方言共用
 * 一个普通话音色等于全员假方言。改成：`chengyu`（四川话）→ `qwen3-tts-flash` +
 * `Sunny`，`yue`（粤语）→ `qwen3-tts-flash` + `Rocky`（官方音色列表核实过这两个
 * 是真实方言音色，见 qwen-tts-voice-list）；`jilu`/`jiaoliao`/`dongbei` 当时判定
 * 云端没有对应方言音色，标成本地 CosyVoice 兜底。
 *
 * 第二轮（code review 后复查）：第一轮漏查了一件事——「CosyVoice 3」不等于
 * 「本地自建推理」，阿里云百炼本身就托管了 CosyVoice v3 作为云端模型
 * （`cosyvoice-v3-flash` / `cosyvoice-v3-plus`），音色表跟 Qwen3-TTS 系列是
 * 分开的两张表。核对 CosyVoice 音色列表（见下方文档链接）确认：
 *
 * - `longanhuan_v3`（龙安欢）：支持 instruct 方言切换，官方列出的方言清单
 *   原文是「普通话、广东话、东北话、河南话、湖南话、陕西话、山东话、四川话、
 *   安徽话」——包含山东话。指令格式固定为「请用<方言>表达。」。
 * - `longlaotie_v3`（龙老铁）：官方标注「东北直率男」，是东北话专属音色，
 *   不需要 instruct 就能出东北口音。
 *
 * 所以 `jilu` 和 `dongbei` 改成走云端 `cosyvoice-v3-flash`，不用再退到本地。
 * `jiaoliao`（青岛话/胶辽官话）维持本地——CosyVoice 音色表里没有青岛专属音色，
 * 而「山东话」这个 instruct 大类能不能准确覆盖胶辽官话的口音，机器猜不出来，
 * 必须真人听测后才能下结论，不该由代码替用户假设着直接套上去。
 *
 * 参考文档：
 * - 方言/音色对照表：https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
 *   （Qwen3-TTS 系）、https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list
 *   （CosyVoice 系，longanhuan_v3/longlaotie_v3 的方言清单在这页）
 * - CosyVoice HTTP API 请求/响应结构：
 *   https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
 *   ——请求 URL 是工作空间专属端点 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，
 *   不是 qwen3-tts-flash 用的公共 `dashscope.aliyuncs.com`；这意味着 jilu/dongbei
 *   这条云端路径要跑通，除了 DASHSCOPE_API_KEY，还得先在百炼控制台把
 *   cosyvoice-v3-flash 部署到一个工作空间、拿到 WorkspaceId——不是纯粹换个模型名
 *   就能零配置直接调用，见 generate-audio.ts 里 DASHSCOPE_WORKSPACE_ID 的说明。
 *
 * 无论哪种情况都刻意不设默认值：某个方言没有确认过的音色，voiceFor() 就要
 * 抛错，不允许静默退回普通话。
 */
const VOICES: Record<string, VoiceSpec> = {
  jilu: {
    model: 'cosyvoice-v3-flash',
    voice: 'longanhuan_v3',
    dialect: '山东话',
    dialectInstruction: '请用山东话表达。',
  },
  jiaoliao: { model: 'cosyvoice3-local', voice: 'qingdao', dialect: '青岛话' },
  chengyu: { model: 'qwen3-tts-flash', voice: 'Sunny', dialect: '四川话' },
  dongbei: { model: 'cosyvoice-v3-flash', voice: 'longlaotie_v3', dialect: '东北话' },
  yue: { model: 'qwen3-tts-flash', voice: 'Rocky', dialect: '粤语' },
};

export function voiceFor(dialectId: string): VoiceSpec {
  const v = VOICES[dialectId];
  if (!v) throw new Error(`方言 ${dialectId} 没有可用音色——不要退回普通话，先确认模型是否支持`);
  return v;
}

// Record<SpeakerRole, string> 是穷举类型（键来自 src/lib/types.ts 的
// SPEAKER_ROLES 唯一真源）——少写或写错一个角色，TS 编译期就会报错，
// 不会留到运行时才发现某个角色查不到指令。
const INSTRUCTS: Record<SpeakerRole, string> = {
  mom: '用非常生气、音量大、语速快的口气说，像家长在训孩子',
  kid: '用不耐烦、敷衍、声音偏小的口气说',
  none: '',
};

export function instructFor(speakerRole: SpeakerRole): string {
  // 运行时防线：speakerRole 实际来自 YAML 解析后的 `as Performance/Scene`
  // 断言，TS 的类型保证在这里不是真的运行时保证。之前的 `?? ''` 会让一个
  // 拼错的角色悄悄退回"无情绪指令"，进而让 generate-audio.ts 用错模型
  // （少了 qwen3-tts-instruct-flash）合成出没有情绪的音频——不允许静默降级，
  // 未知角色直接抛错，参照本文件 voiceFor() 的既定做法。
  if (!SPEAKER_ROLES.includes(speakerRole)) {
    throw new Error(
      `未知的 speakerRole：${speakerRole}——不要静默返回空指令，先确认这个角色是否遗漏`,
    );
  }
  return INSTRUCTS[speakerRole];
}

/**
 * 百炼语音合成计费字符数：1 个汉字算 2 个有效字符，英文字母、全角/半角标点
 * 符号均算 1 个字符——这条规则原文核对过阿里云计费说明（智能语音交互计费
 * 文档：「1个汉字算2个有效字符，英文字母、全半角标点符号均算1个有效字符」），
 * brief 里的规则本身是对的，但实现有一个静默 bug：brief 的正则
 * `/[一-鿿　-〿＀-￯]/` 把 CJK 标点符号区（U+3000–U+303F）和全角 ASCII 变体区
 * （U+FF00–U+FFEF，包含全角标点如「？」「，」）也算进了「翻倍」范围，导致中文
 * 句子里的全角标点被多计了一倍——这就是「代价高的隐性 bug」，已在这里改成只
 * 匹配 CJK 统一表意文字本身（U+4E00–U+9FFF），标点和其余字符一律按 1 计。
 */
export function countBilledChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[一-鿿]/.test(ch) ? 2 : 1;
  }
  return n;
}
