/** 《中国语言地图集》五层分区：大区—区—片—小片—点 */
export type DialectLevel = 'supergroup' | 'group' | 'cluster' | 'subcluster' | 'point';

export interface Dialect {
  id: string;
  name: string;
  level: DialectLevel;
  parentId: string | null;
  lng?: number;
  lat?: number;
  description?: string;
}

/** 空拍的保留角色名：这一拍没人说话，不合成音频 */
export const NO_SPEAKER = 'none';

/**
 * 声色档位。TTS 音色按「方言 × 声色」两个维度查表（scripts/gen/src/tts.ts
 * 的 VOICES），而不是一个方言一个音色——一场家庭戏里妈妈和孩子必须是两种
 * 声色，全用同一个音色等于两个人共用一副嗓子，戏就散了。
 *
 * 档位是「场景描述角色」和「方言提供音色」之间的中间层：场景只说这个角色
 * 是什么声色（成年女性/成年男性…），各方言各自去找自己有的、能对上这个档位
 * 的真实方言音色。这样加新场景不用碰 TTS 代码，加新方言不用碰场景数据。
 */
export const VOICE_PROFILES = ['adult_female', 'adult_male', 'young_female', 'young_male'] as const;
export type VoiceProfile = (typeof VOICE_PROFILES)[number];

/**
 * 场景里的一个角色。角色是**场景自己声明的**，不是写死在代码里的枚举——
 * 「妈妈/孩子」只属于「深夜回家」，换成「菜市场砍价」就该是「摊主/顾客」。
 * 早先把 mom/kid 写死在 SPEAKER_ROLES 里，直接导致加第二个场景要改代码。
 */
export interface SceneRole {
  /** 页面上显示的称呼，比如「妈妈」 */
  name: string;
  /** 这个角色用哪一档声色 */
  voice: VoiceProfile;
  /** TTS 情绪指令，比如「用非常生气、音量大、语速快的口气说」；留空表示不加情绪 */
  mood?: string;
}

/**
 * 谁在说话：取值必须是所属场景 `roles` 里声明过的键，或保留值 'none'（空拍）。
 * 这是运行时约束，由 validateContent() 在构建期强制——TS 这里只能是 string，
 * 因为合法集合随场景而变，编译期不可知。
 */
export type SpeakerRole = string;

export interface Beat {
  id: string;
  order: number;
  intent: string;
  /** 谁在说话，必须是本场景 roles 的键或 'none' */
  speakerRole: SpeakerRole;
}

export interface Scene {
  id: string;
  title: string;
  situation: string;
  /** 本场景的角色表，键就是 beats 里 speakerRole 的合法取值 */
  roles: Record<string, SceneRole>;
  beats: Beat[];
}

/**
 * 三档可信度：unverified（AI 生成、未经母语者校对）/ native_verified
 * （AI 生成、已经母语者校对）/ human_recorded（真人录音）。这三档必须在
 * 页面上视觉可辨，不许塌成两档——见 src/lib/verification.ts。
 */
export const VERIFICATIONS = ['unverified', 'native_verified', 'human_recorded'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const PERFORMANCE_SOURCES = ['tts', 'human'] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

export interface PerformanceLine {
  beatId: string;
  textDialect: string;
  textMandarin: string;
  note?: string;
  /** public/ 下的音频路径；未生成时为空 */
  audio?: string;
}

export interface Performance {
  id: string;
  sceneId: string;
  dialectId: string;
  source: PerformanceSource;
  verification: Verification;
  contributor?: string;
  verifier?: string;
  lines: PerformanceLine[];
}
