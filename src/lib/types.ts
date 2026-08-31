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

/**
 * 谁在说话——用于主视觉高亮（对应人物剪影的 data-fig="mom"/"kid"）与 TTS 情绪
 * 指令（scripts/gen/src/tts.ts 的 INSTRUCTS）。这是唯一真源：player.ts、tts.ts
 * 的映射表都必须从这里取值，不允许各自再维护一份候选集合——否则漏改一处，
 * 新角色就会在某个消费方那里悄悄查不到、静默降级（剪影全部调暗、或情绪指令
 * 悄悄退回空串）。'none' 表示空拍，没人说话。
 */
export const SPEAKER_ROLES = ['mom', 'kid', 'none'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export interface Beat {
  id: string;
  order: number;
  intent: string;
  /** 谁在说话，取值必须属于 SPEAKER_ROLES；'none' 表示空拍 */
  speakerRole: SpeakerRole;
}

export interface Scene {
  id: string;
  title: string;
  situation: string;
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
