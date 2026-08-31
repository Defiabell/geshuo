import { VOICE_PROFILES } from '../../../src/lib/types';
import type { VoiceProfile } from '../../../src/lib/types';

export interface VoiceSpec {
  model: string;
  voice: string;
  /** 这个音色实际说的方言，用于日志与测试断言 */
  dialect: string;
  /**
   * 方言切换指令（固定格式「请用<方言>表达。」）。
   * 只有走 instruction 路径的音色需要——音色本身就是方言专属的（比如粤语的
   * Rocky、东北话的 longlaotie_v3）留空。
   */
  dialectInstruction?: string;
}

/**
 * 方言 × 声色 → 音色。
 *
 * ## 为什么是二维表
 *
 * 一开始是一维的（一个方言一个音色），结果一场家庭戏里妈妈和孩子共用一副
 * 嗓子，两个人听起来是同一个人在自问自答。声色必须跟着角色走，所以查表键
 * 变成「方言 × 声色档位」，档位由场景自己声明（src/data/scenes/*.yaml 的
 * roles[].voice）。
 *
 * ## 选音色的规则：方言专属音色优先
 *
 * 有两条能出方言的路：
 *
 * 1. **方言专属音色**——音色本身就说那个方言（四川的 Sunny/Eric、粤语的
 *    Kiki/Rocky、东北话的 longlaotie_v3）。不需要任何指令，方言是音色自带的。
 * 2. **instruction 指令切换**——通用音色 + 一句「请用山东话表达。」。
 *
 * 有专属音色就用专属的，这是默认规则：让模型模仿一个口音，不如用一个本来
 * 就在说这个口音的音色。只有在没有专属音色时（山东话就没有）才走指令路径。
 *
 * ## 关于 instruction 的实测结论（2026-09-01，真实 API，非文档推断）
 *
 * 这里踩过一个静默出错的大坑，值得写清楚以免重蹈：
 *
 * **`cosyvoice-v3-flash` 完全无视 `instruct` 字段。** 用同一段文本、同一个
 * 音色（longanhuan_v3），分别传「用非常生气的口气说」「用悲伤的口气说」
 * 「请用山东话表达。」「请用河南话表达。」和完全不传——**五次返回的音频
 * 字节完全相同（md5 一致）**。字段名换成 `instruction` 会被引擎拒成 428，
 * 换到 `parameters` 层级同样无效。也就是说：之前靠「longanhuan_v3 + 请用
 * 山东话表达。」生成的所谓冀鲁官话，根本不是山东话，是这个音色的默认普通话
 * ——正是本项目最不能犯的错（静默退回普通话），而且发生在作者自己的家乡话上。
 *
 * **正确的指令路径是 `qwen-audio-3.0-tts-flash`**（同一个
 * /api/v1/services/audio/tts/SpeechSynthesizer 端点），字段是 `input.instruction`。
 * 实测：带方言指令与不带指令输出不同（指令确实生效），且情绪指令可以和方言
 * 指令叠加（「请用山东话表达。用非常生气的口气说。」与只有方言指令的输出不同）。
 * 这个模型的系统音色是另一套（带 _v3.6 后缀），实测可用的有：
 * `longanhuan_v3.6`（女）、`loongjohn`（男）、`longjielidou_v3.6`、
 * `loongeva_v3.6`；Qwen3-TTS 那套名字（Sunny/Rocky/Cherry…）在这个模型上一律 400。
 *
 * **判断指令有没有生效的办法**：同一段文本跑两次，一次带指令一次不带，比 md5。
 * 相同就是被无视了——这个对照比读文档可靠，文档在这件事上误导过两次。
 *
 * ## 音色出处
 * - Qwen3-TTS 方言音色表：https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
 *   （Sunny 四川女 / Eric 四川男 / Rocky 粤语男 / Kiki 粤语女，均已实测可用）
 * - CosyVoice 音色表：https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list
 *   （longlaotie_v3 东北话专属男声）
 * - 两张表都没有山东话专属音色，所以冀鲁官话只能走 instruction 路径。
 *
 * 任何方言 × 声色查不到，voiceFor() 一律抛错——不允许静默退回普通话，也不
 * 允许拿邻近方言顶替。这是产品红线。
 */
export const INSTRUCT_MODEL = 'qwen-audio-3.0-tts-flash';

const VOICES: Record<string, Partial<Record<VoiceProfile, VoiceSpec>>> = {
  // 四川话：有成对的方言专属音色，不需要任何指令
  chengyu: {
    adult_female: { model: 'qwen3-tts-flash', voice: 'Sunny', dialect: '四川话' },
    adult_male: { model: 'qwen3-tts-flash', voice: 'Eric', dialect: '四川话' },
  },
  // 粤语：同样有成对的方言专属音色
  yue: {
    adult_female: { model: 'qwen3-tts-flash', voice: 'Kiki', dialect: '粤语' },
    adult_male: { model: 'qwen3-tts-flash', voice: 'Rocky', dialect: '粤语' },
  },
  // 东北话：男声有专属音色（龙老铁），女声没有，只能走指令
  dongbei: {
    adult_female: {
      model: INSTRUCT_MODEL,
      voice: 'longanhuan_v3.6',
      dialect: '东北话',
      dialectInstruction: '请用东北话表达。',
    },
    adult_male: { model: 'cosyvoice-v3-flash', voice: 'longlaotie_v3', dialect: '东北话' },
  },
  // 山东话：两张音色表里都没有专属音色，男女都只能走指令路径
  jilu: {
    adult_female: {
      model: INSTRUCT_MODEL,
      voice: 'longanhuan_v3.6',
      dialect: '山东话',
      dialectInstruction: '请用山东话表达。',
    },
    adult_male: {
      model: INSTRUCT_MODEL,
      voice: 'loongjohn',
      dialect: '山东话',
      dialectInstruction: '请用山东话表达。',
    },
  },
  // 胶辽官话（青岛）刻意留空：没有胶辽专属音色，而「山东话」这个指令大类
  // 能不能覆盖胶东口音，机器判断不了，必须真人听测。留空 → voiceFor 抛错，
  // 好过悄悄套一个听起来像济南话的东西冒充青岛话。
};

export function voiceFor(dialectId: string, profile: VoiceProfile): VoiceSpec {
  if (!VOICE_PROFILES.includes(profile)) {
    throw new Error(`未知声色档位 ${profile}——必须是 ${VOICE_PROFILES.join(' / ')} 之一`);
  }
  const byProfile = VOICES[dialectId];
  if (!byProfile) {
    throw new Error(`方言 ${dialectId} 没有可用音色——不要退回普通话，先确认模型是否支持`);
  }
  const spec = byProfile[profile];
  if (!spec) {
    throw new Error(
      `方言 ${dialectId} 没有 ${profile} 档的可用音色（现有：${Object.keys(byProfile).join(' / ')}）——` +
        '不要拿别的档位顶替，也不要退回普通话',
    );
  }
  return spec;
}

/**
 * 把情绪指令和方言切换指令拼成一句下发给模型的 instruction。
 * 顺序是「方言在前、情绪在后」：方言是这句话的底，情绪是加在底上的。
 * 两者都为空则返回空串，调用方据此决定是否带这个字段。
 */
export function instructionFor(mood: string | undefined, spec: VoiceSpec): string {
  return [spec.dialectInstruction, mood].filter(Boolean).join('');
}

/**
 * 百炼语音合成计费字符数：1 个汉字算 2 个有效字符，英文字母、全角/半角标点
 * 符号均算 1 个字符——核对过阿里云计费说明原文（「1个汉字算2个有效字符，
 * 英文字母、全半角标点符号均算1个有效字符」）。只匹配 CJK 统一表意文字本身
 * （U+4E00–U+9FFF）；CJK 标点区和全角 ASCII 变体区不翻倍，否则中文句子里的
 * 「？」「，」会被多计一倍。
 */
export function countBilledChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[一-鿿]/.test(ch) ? 2 : 1;
  }
  return n;
}
